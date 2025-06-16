import { EventEmitter } from "events";
import ClusterAllFailedError from "../errors/ClusterAllFailedError";
import { defaults, noop, Debug } from "../utils";
import ConnectionPool from "./ConnectionPool";
import {
  NodeKey,
  IRedisOptions,
  normalizeNodeOptions,
  NodeRole,
  getUniqueHostnamesFromOptions,
  nodeKeyToRedisOptions,
  groupSrvRecords,
  weightSrvRecords,
  getConnectionName,
  getNodeKey,
} from "./util";
import ClusterSubscriber from "./ClusterSubscriber";
import DelayQueue from "./DelayQueue";
import ScanStream from "../ScanStream";
import { AbortError, RedisError } from "redis-errors";
import asCallback from "standard-as-callback";
import * as PromiseContainer from "../promiseContainer";
import { CallbackFunction } from "../types";
import { IClusterOptions, DEFAULT_CLUSTER_OPTIONS } from "./ClusterOptions";
import {
  sample,
  CONNECTION_CLOSED_ERROR_MSG,
  shuffle,
  timeout,
  zipMap,
} from "../utils";
import { exists, hasFlag } from "@ioredis/commands";
import Command from "../command";
import Redis from "../redis";
import Commander from "../commander";
import Deque = require("denque");
import { Pipeline } from "..";
import ClusterSubscriberGroup from "./ClusterSubscriberGroup";

const debug = Debug("cluster");

type ClusterStatus =
  | "end"
  | "close"
  | "wait"
  | "connecting"
  | "connect"
  | "ready"
  | "reconnecting"
  | "disconnecting";

/**
 * Client for the official Redis Cluster
 *
 * @class Cluster
 * @extends {EventEmitter}
 */
class Cluster extends EventEmitter {
  private options: IClusterOptions;
  private startupNodes: (string | number | object)[];
  private connectionPool: ConnectionPool;
  public slots: NodeKey[][] = [];
  private manuallyClosing: boolean;
  private retryAttempts = 0;
  private delayQueue: DelayQueue = new DelayQueue();
  private offlineQueue = new Deque();
  private subscriber: ClusterSubscriber;
  private shardedSubscribers: ClusterSubscriberGroup;
  private slotsTimer: NodeJS.Timer;
  private reconnectTimeout: NodeJS.Timer;
  private status: ClusterStatus;
  private isRefreshing = false;
  private _refreshSlotsCacheCallbacks = [];
  public isCluster = true;
  private _autoPipelines: Map<string, typeof Pipeline> = new Map();
  private _groupsIds: { [key: string]: number } = {};
  private _groupsBySlot: number[] = Array(16384);
  private _runningAutoPipelines: Set<string> = new Set();
  private _readyDelayedCallbacks: CallbackFunction[] = [];
  public _addedScriptHashes: { [key: string]: any } = {};
  public _addedScriptHashesCleanInterval: NodeJS.Timeout;

  /**
   * Every time Cluster#connect() is called, this value will be
   * auto-incrementing. The purpose of this value is used for
   * discarding previous connect attampts when creating a new
   * connection.
   *
   * @private
   * @type {number}
   * @memberof Cluster
   */
  private connectionEpoch = 0;

  /**
   * Creates an instance of Cluster.
   *
   * @param {((string | number | object)[])} startupNodes
   * @param {IClusterOptions} [options={}]
   * @memberof Cluster
   */
  constructor(
    startupNodes: (string | number | object)[],
    options: IClusterOptions = {}
  ) {
    super();
    Commander.call(this);

    this.startupNodes = startupNodes;
    this.options = defaults({}, options, DEFAULT_CLUSTER_OPTIONS, this.options);

    if (this.options.shardedSubscribers == true)
      this.shardedSubscribers = new ClusterSubscriberGroup(
        this,
        this.refreshSlotsCache.bind(this)
      );

    // validate options
    if (
      typeof this.options.scaleReads !== "function" &&
      ["all", "master", "slave"].indexOf(this.options.scaleReads) === -1
    ) {
      throw new Error(
        'Invalid option scaleReads "' +
          this.options.scaleReads +
          '". Expected "all", "master", "slave" or a custom function'
      );
    }

    this.connectionPool = new ConnectionPool(this.options.redisOptions);

    this.connectionPool.on("-node", (redis, key) => {
      this.emit("-node", redis);
    });
    this.connectionPool.on("+node", (redis) => {
      this.emit("+node", redis);
    });
    this.connectionPool.on("drain", () => {
      this.setStatus("close");
    });
    this.connectionPool.on("nodeError", (error, key) => {
      this.emit("node error", error, key);
    });

    this.subscriber = new ClusterSubscriber(this.connectionPool, this);

    if (this.options.lazyConnect) {
      this.setStatus("wait");
    } else {
      this.connect().catch((err) => {
        debug("connecting failed: %s", err);
      });
    }
  }

  resetOfflineQueue() {
    this.offlineQueue = new Deque();
  }

  clearNodesRefreshInterval() {
    if (this.slotsTimer) {
      clearTimeout(this.slotsTimer);
      this.slotsTimer = null;
    }
  }

  clearAddedScriptHashesCleanInterval() {
    if (this._addedScriptHashesCleanInterval) {
      clearInterval(this._addedScriptHashesCleanInterval);
      this._addedScriptHashesCleanInterval = null;
    }
  }

  resetNodesRefreshInterval() {
    if (this.slotsTimer || this.options.slotsRefreshInterval < 0) {
      return;
    }
    const nextRound = () => {
      this.slotsTimer = setTimeout(() => {
        debug(
          'refreshing slot caches... (triggered by "slotsRefreshInterval" option)'
        );
        this.refreshSlotsCache(() => {
          nextRound();
        });
      }, this.options.slotsRefreshInterval);
    };

    nextRound();
  }

  /**
   * Connect to a cluster
   *
   * @returns {Promise<void>}
   * @memberof Cluster
   */
  public connect(): Promise<void> {
    const Promise = PromiseContainer.get();
    return new Promise((resolve, reject) => {
      if (
        this.status === "connecting" ||
        this.status === "connect" ||
        this.status === "ready"
      ) {
        reject(new Error("Redis is already connecting/connected"));
        return;
      }

      // Make sure only one timer is active at a time
      this.clearAddedScriptHashesCleanInterval();

      // Start the script cache cleaning
      this._addedScriptHashesCleanInterval = setInterval(() => {
        this._addedScriptHashes = {};
      }, this.options.maxScriptsCachingTime);

      const epoch = ++this.connectionEpoch;
      this.setStatus("connecting");

      this.resolveStartupNodeHostnames()
        .then((nodes) => {
          if (this.connectionEpoch !== epoch) {
            debug(
              "discard connecting after resolving startup nodes because epoch not match: %d != %d",
              epoch,
              this.connectionEpoch
            );
            reject(
              new RedisError(
                "Connection is discarded because a new connection is made"
              )
            );
            return;
          }
          if (this.status !== "connecting") {
            debug(
              "discard connecting after resolving startup nodes because the status changed to %s",
              this.status
            );
            reject(new RedisError("Connection is aborted"));
            return;
          }
          this.connectionPool.reset(nodes);

          function readyHandler() {
            this.setStatus("ready");
            this.retryAttempts = 0;
            this.executeOfflineCommands();
            this.resetNodesRefreshInterval();
            resolve();
          }

          let closeListener: () => void = undefined;
          const refreshListener = () => {
            this.invokeReadyDelayedCallbacks(undefined);
            this.removeListener("close", closeListener);
            this.manuallyClosing = false;
            this.setStatus("connect");
            if (this.options.enableReadyCheck) {
              this.readyCheck((err, fail) => {
                if (err || fail) {
                  debug(
                    "Ready check failed (%s). Reconnecting...",
                    err || fail
                  );
                  if (this.status === "connect") {
                    this.disconnect(true);
                  }
                } else {
                  readyHandler.call(this);
                }
              });
            } else {
              readyHandler.call(this);
            }
          };

          closeListener = function () {
            const error = new Error("None of startup nodes is available");

            this.removeListener("refresh", refreshListener);
            this.invokeReadyDelayedCallbacks(error);
            reject(error);
          };

          this.once("refresh", refreshListener);
          this.once("close", closeListener);
          this.once("close", this.handleCloseEvent.bind(this));

          this.refreshSlotsCache((err) => {
            if (err && err.message === "Failed to refresh slots cache.") {
              Redis.prototype.silentEmit.call(this, "error", err);
              this.connectionPool.reset([]);
            }
          });

          this.subscriber.start();

          if (this.options.shardedSubscribers) {
            this.shardedSubscribers.start();
          }
        })
        .catch((err) => {
          this.setStatus("close");
          this.handleCloseEvent(err);
          this.invokeReadyDelayedCallbacks(err);
          reject(err);
        });
    });
  }

  /**
   * Called when closed to check whether a reconnection should be made
   *
   * @private
   * @memberof Cluster
   */
  private handleCloseEvent(reason?: Error): void {
    if (reason) {
      debug("closed because %s", reason);
    }

    this.clearAddedScriptHashesCleanInterval();

    let retryDelay;
    if (
      !this.manuallyClosing &&
      typeof this.options.clusterRetryStrategy === "function"
    ) {
      retryDelay = this.options.clusterRetryStrategy.call(
        this,
        ++this.retryAttempts,
        reason
      );
    }
    if (typeof retryDelay === "number") {
      this.setStatus("reconnecting");
      this.reconnectTimeout = setTimeout(
        function () {
          this.reconnectTimeout = null;
          debug("Cluster is disconnected. Retrying after %dms", retryDelay);
          this.connect().catch(function (err) {
            debug("Got error %s when reconnecting. Ignoring...", err);
          });
        }.bind(this),
        retryDelay
      );
    } else {
      this.setStatus("end");
      this.flushQueue(new Error("None of startup nodes is available"));
    }
  }

  /**
   * Disconnect from every node in the cluster.
   *
   * @param {boolean} [reconnect=false]
   * @memberof Cluster
   */
  public disconnect(reconnect = false) {
    const status = this.status;
    this.setStatus("disconnecting");

    this.clearAddedScriptHashesCleanInterval();

    if (!reconnect) {
      this.manuallyClosing = true;
    }
    if (this.reconnectTimeout && !reconnect) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
      debug("Canceled reconnecting attempts");
    }
    this.clearNodesRefreshInterval();

    this.subscriber.stop();

    if (this.options.shardedSubscribers) {
      this.shardedSubscribers.stop();
    }

    if (status === "wait") {
      this.setStatus("close");
      this.handleCloseEvent();
    } else {
      this.connectionPool.reset([]);
    }
  }

  /**
   * Quit the cluster gracefully.
   *
   * @param {CallbackFunction<'OK'>} [callback]
   * @returns {Promise<'OK'>}
   * @memberof Cluster
   */
  public quit(callback?: CallbackFunction<"OK">): Promise<"OK"> {
    const status = this.status;
    this.setStatus("disconnecting");

    this.clearAddedScriptHashesCleanInterval();

    this.manuallyClosing = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearNodesRefreshInterval();

    this.subscriber.stop();

    const Promise = PromiseContainer.get();
    if (status === "wait") {
      const ret = asCallback(Promise.resolve<"OK">("OK"), callback);

      // use setImmediate to make sure "close" event
      // being emitted after quit() is returned
      setImmediate(
        function () {
          this.setStatus("close");
          this.handleCloseEvent();
        }.bind(this)
      );

      return ret;
    }
    return asCallback(
      Promise.all(
        this.nodes().map((node) =>
          node.quit().catch((err) => {
            // Ignore the error caused by disconnecting since
            // we're disconnecting...
            if (err.message === CONNECTION_CLOSED_ERROR_MSG) {
              return "OK";
            }
            throw err;
          })
        )
      ).then(() => "OK"),
      callback
    );
  }

  /**
   * Create a new instance with the same startup nodes and options as the current one.
   *
   * @example
   * ```js
   * var cluster = new Redis.Cluster([{ host: "127.0.0.1", port: "30001" }]);
   * var anotherCluster = cluster.duplicate();
   * ```
   *
   * @public
   * @param {((string | number | object)[])} [overrideStartupNodes=[]]
   * @param {IClusterOptions} [overrideOptions={}]
   * @memberof Cluster
   */
  public duplicate(overrideStartupNodes = [], overrideOptions = {}) {
    const startupNodes =
      overrideStartupNodes.length > 0
        ? overrideStartupNodes
        : this.startupNodes.slice(0);
    const options = Object.assign({}, this.options, overrideOptions);
    return new Cluster(startupNodes, options);
  }

  /**
   * Get nodes with the specified role
   *
   * @param {NodeRole} [role='all']
   * @returns {any[]}
   * @memberof Cluster
   */
  public nodes(role: NodeRole = "all"): any[] {
    if (role !== "all" && role !== "master" && role !== "slave") {
      throw new Error(
        'Invalid role "' + role + '". Expected "all", "master" or "slave"'
      );
    }
    return this.connectionPool.getNodes(role);
  }

  // This is needed in order not to install a listener for each auto pipeline
  public delayUntilReady(callback: CallbackFunction) {
    this._readyDelayedCallbacks.push(callback);
  }

  /**
   * Get the number of commands queued in automatic pipelines.
   *
   * This is not available (and returns 0) until the cluster is connected and slots information have been received.
   */
  get autoPipelineQueueSize(): number {
    let queued = 0;

    for (const pipeline of this._autoPipelines.values()) {
      queued += pipeline.length;
    }

    return queued;
  }

  /**
   * Change cluster instance's status
   *
   * @private
   * @param {ClusterStatus} status
   * @memberof Cluster
   */
  private setStatus(status: ClusterStatus): void {
    debug("status: %s -> %s", this.status || "[empty]", status);
    this.status = status;
    process.nextTick(() => {
      this.emit(status);
    });
  }

  /**
   * Refresh the slot cache
   *
   * @private
   * @param {CallbackFunction} [callback]
   * @memberof Cluster
   */
  private refreshSlotsCache(callback?: CallbackFunction<void>): void {
    if (typeof callback === "function") {
      this._refreshSlotsCacheCallbacks.push(callback);
    }

    if (this.isRefreshing) {
      return;
    }
    this.isRefreshing = true;

    const wrapper = (error?: Error) => {
      this.isRefreshing = false;
      for (const callback of this._refreshSlotsCacheCallbacks) {
        callback(error);
      }

      this._refreshSlotsCacheCallbacks = [];
    };

    const nodes = shuffle(this.connectionPool.getNodes());

    let lastNodeError = null;

    const tryNode = (index: number) => {
      if (index === nodes.length) {
        const error = new ClusterAllFailedError(
          "Failed to refresh slots cache.",
          lastNodeError
        );
        return wrapper(error);
      }
      const node = nodes[index];
      const key = `${node.options.host}:${node.options.port}`;
      debug("getting slot cache from %s", key);
      this.getInfoFromNode(node, (err) => {
        switch (this.status) {
          case "close":
          case "end":
            return wrapper(new Error("Cluster is disconnected."));
          case "disconnecting":
            return wrapper(new Error("Cluster is disconnecting."));
        }
        if (err) {
          this.emit("node error", err, key);
          lastNodeError = err;
          tryNode(index + 1);
        } else {
          this.emit("refresh");
          wrapper();
        }
      });
    };

    tryNode(0);
  }

  /**
   * Flush offline queue with error.
   *
   * @param {Error} error
   * @memberof Cluster
   */
  private flushQueue(error: Error) {
    let item;
    while (this.offlineQueue.length > 0) {
      item = this.offlineQueue.shift();
      item.command.reject(error);
    }
  }

  executeOfflineCommands() {
    if (this.offlineQueue.length) {
      debug("send %d commands in offline queue", this.offlineQueue.length);
      const offlineQueue = this.offlineQueue;
      this.resetOfflineQueue();
      while (offlineQueue.length > 0) {
        const item = offlineQueue.shift();
        this.sendCommand(item.command, item.stream, item.node);
      }
    }
  }

  natMapper(nodeKey: NodeKey | IRedisOptions): IRedisOptions {
    if (this.options.natMap && typeof this.options.natMap === "object") {
      const key =
        typeof nodeKey === "string"
          ? nodeKey
          : `${nodeKey.host}:${nodeKey.port}`;
      const mapped = this.options.natMap[key];
      if (mapped) {
        debug("NAT mapping %s -> %O", key, mapped);
        return Object.assign({}, mapped);
      }
    }
    return typeof nodeKey === "string"
      ? nodeKeyToRedisOptions(nodeKey)
      : nodeKey;
  }

  sendCommand(command, stream, node) {
    if (this.status === "wait") {
      this.connect().catch(noop);
    }
    if (this.status === "end") {
      command.reject(new Error(CONNECTION_CLOSED_ERROR_MSG));
      return command.promise;
    }
    let to = this.options.scaleReads;
    if (to !== "master") {
      const isCommandReadOnly =
        command.isReadOnly ||
        (exists(command.name) && hasFlag(command.name, "readonly"));
      if (!isCommandReadOnly) {
        to = "master";
      }
    }

    let targetSlot = node ? node.slot : command.getSlot();
    const ttl = {};
    const _this = this;
    if (!node && !command.__is_reject_overwritten) {
      // eslint-disable-next-line @typescript-eslint/camelcase
      command.__is_reject_overwritten = true;
      const reject = command.reject;
      command.reject = function (err) {
        const partialTry = tryConnection.bind(null, true);
        _this.handleError(err, ttl, {
          moved: function (slot, key) {
            debug("command %s is moved to %s", command.name, key);
            targetSlot = Number(slot);
            if (_this.slots[slot]) {
              _this.slots[slot][0] = key;
            } else {
              _this.slots[slot] = [key];
            }
            _this._groupsBySlot[slot] =
              _this._groupsIds[_this.slots[slot].join(";")];
            _this.connectionPool.findOrCreate(_this.natMapper(key));
            tryConnection();
            debug("refreshing slot caches... (triggered by MOVED error)");
            _this.refreshSlotsCache();
          },
          ask: function (slot, key) {
            debug("command %s is required to ask %s:%s", command.name, key);
            const mapped = _this.natMapper(key);
            _this.connectionPool.findOrCreate(mapped);
            tryConnection(false, `${mapped.host}:${mapped.port}`);
          },
          tryagain: partialTry,
          clusterDown: partialTry,
          connectionClosed: partialTry,
          maxRedirections: function (redirectionError) {
            reject.call(command, redirectionError);
          },
          defaults: function () {
            reject.call(command, err);
          },
        });
      };
    }
    tryConnection();

    function tryConnection(random?: boolean, asking?: string) {
      if (_this.status === "end") {
        command.reject(new AbortError("Cluster is ended."));
        return;
      }
      let redis;
      if (_this.status === "ready" || command.name === "cluster") {
        if (node && node.redis) {
          redis = node.redis;
        } else if (
          Command.checkFlag("ENTER_SUBSCRIBER_MODE", command.name) ||
          Command.checkFlag("EXIT_SUBSCRIBER_MODE", command.name)
        ) {
          if (
            _this.options.shardedSubscribers == true &&
            (command.name == "ssubscribe" || command.name == "sunsubscribe")
          ) {
            const sub: ClusterSubscriber =
              _this.shardedSubscribers.getResponsibleSubscriber(targetSlot);
            let status = -1;

            if (command.name == "ssubscribe")
              status = _this.shardedSubscribers.addChannels(command.getKeys());
            if (command.name == "sunsubscribe")
              status = _this.shardedSubscribers.removeChannels(
                command.getKeys()
              );
            if (status !== -1) {
              redis = sub.getInstance();
            } else {
              command.reject(
                new AbortError(
                  "Can't add or remove the given channels. Are they in the same slot?"
                )
              );
            }
          } else {
            redis = _this.subscriber.getInstance();
          }

          if (!redis) {
            command.reject(new AbortError("No subscriber for the cluster"));
            return;
          }
        } else {
          if (!random) {
            if (typeof targetSlot === "number" && _this.slots[targetSlot]) {
              const nodeKeys = _this.slots[targetSlot];
              if (typeof to === "function") {
                const nodes = nodeKeys.map(function (key) {
                  return _this.connectionPool.getInstanceByKey(key);
                });
                redis = to(nodes, command);
                if (Array.isArray(redis)) {
                  redis = sample(redis);
                }
                if (!redis) {
                  redis = nodes[0];
                }
              } else {
                let key;
                if (to === "all") {
                  key = sample(nodeKeys);
                } else if (to === "slave" && nodeKeys.length > 1) {
                  key = sample(nodeKeys, 1);
                } else {
                  key = nodeKeys[0];
                }
                redis = _this.connectionPool.getInstanceByKey(key);
              }
            }
            if (asking) {
              redis = _this.connectionPool.getInstanceByKey(asking);
              redis.asking();
            }
          }
          if (!redis) {
            redis =
              (typeof to === "function"
                ? null
                : _this.connectionPool.getSampleInstance(to)) ||
              _this.connectionPool.getSampleInstance("all");
          }
        }
        if (node && !node.redis) {
          node.redis = redis;
        }
      }
      if (redis) {
        redis.sendCommand(command, stream);
      } else if (_this.options.enableOfflineQueue) {
        _this.offlineQueue.push({
          command: command,
          stream: stream,
          node: node,
        });
      } else {
        command.reject(
          new Error(
            "Cluster isn't ready and enableOfflineQueue options is false"
          )
        );
      }
    }
    return command.promise;
  }

  handleError(error, ttl, handlers) {
    if (typeof ttl.value === "undefined") {
      ttl.value = this.options.maxRedirections;
    } else {
      ttl.value -= 1;
    }
    if (ttl.value <= 0) {
      handlers.maxRedirections(
        new Error("Too many Cluster redirections. Last error: " + error)
      );
      return;
    }
    const errv = error.message.split(" ");
    if (errv[0] === "MOVED") {
      const timeout = this.options.retryDelayOnMoved;
      if (timeout && typeof timeout === "number") {
        this.delayQueue.push(
          "moved",
          handlers.moved.bind(null, errv[1], errv[2]),
          { timeout }
        );
      } else {
        handlers.moved(errv[1], errv[2]);
      }
    } else if (errv[0] === "ASK") {
      handlers.ask(errv[1], errv[2]);
    } else if (errv[0] === "TRYAGAIN") {
      this.delayQueue.push("tryagain", handlers.tryagain, {
        timeout: this.options.retryDelayOnTryAgain,
      });
    } else if (
      errv[0] === "CLUSTERDOWN" &&
      this.options.retryDelayOnClusterDown > 0
    ) {
      this.delayQueue.push("clusterdown", handlers.connectionClosed, {
        timeout: this.options.retryDelayOnClusterDown,
        callback: this.refreshSlotsCache.bind(this),
      });
    } else if (
      error.message === CONNECTION_CLOSED_ERROR_MSG &&
      this.options.retryDelayOnFailover > 0 &&
      this.status === "ready"
    ) {
      this.delayQueue.push("failover", handlers.connectionClosed, {
        timeout: this.options.retryDelayOnFailover,
        callback: this.refreshSlotsCache.bind(this),
      });
    } else {
      handlers.defaults();
    }
  }

  getInfoFromNode(redis, callback) {
    if (!redis) {
      return callback(new Error("Node is disconnected"));
    }

    // Use a duplication of the connection to avoid
    // timeouts when the connection is in the blocking
    // mode (e.g. waiting for BLPOP).
    const duplicatedConnection = redis.duplicate({
      enableOfflineQueue: true,
      enableReadyCheck: false,
      retryStrategy: null,
      connectionName: getConnectionName(
        "refresher",
        this.options.redisOptions && this.options.redisOptions.connectionName
      ),
    });

    // Ignore error events since we will handle
    // exceptions for the CLUSTER SLOTS command.
    duplicatedConnection.on("error", noop);

    duplicatedConnection.cluster(
      "slots",
      timeout((err, result) => {
        duplicatedConnection.disconnect();
        if (err) {
          return callback(err);
        }
        if (
          this.status === "disconnecting" ||
          this.status === "close" ||
          this.status === "end"
        ) {
          debug(
            "ignore CLUSTER.SLOTS results (count: %d) since cluster status is %s",
            result.length,
            this.status
          );
          callback();
          return;
        }
        const nodes = [];

        debug("cluster slots result count: %d", result.length);

        for (let i = 0; i < result.length; ++i) {
          const items = result[i];
          const slotRangeStart = items[0];
          const slotRangeEnd = items[1];

          const keys = [];
          for (let j = 2; j < items.length; j++) {
            if (!items[j][0]) {
              continue;
            }
            items[j] = this.natMapper({ host: items[j][0], port: items[j][1] });
            items[j].readOnly = j !== 2;
            nodes.push(items[j]);
            keys.push(items[j].host + ":" + items[j].port);
          }

          debug(
            "cluster slots result [%d]: slots %d~%d served by %s",
            i,
            slotRangeStart,
            slotRangeEnd,
            keys
          );

          for (let slot = slotRangeStart; slot <= slotRangeEnd; slot++) {
            this.slots[slot] = keys;
          }
        }

        // Assign to each node keys a numeric value to make autopipeline comparison faster.
        this._groupsIds = Object.create(null);
        let j = 0;
        for (let i = 0; i < 16384; i++) {
          const target = (this.slots[i] || []).join(";");

          if (!target.length) {
            this._groupsBySlot[i] = undefined;
            continue;
          }

          if (!this._groupsIds[target]) {
            this._groupsIds[target] = ++j;
          }

          this._groupsBySlot[i] = this._groupsIds[target];
        }

        this.connectionPool.reset(nodes);
        callback();
      }, this.options.slotsRefreshTimeout)
    );
  }

  private invokeReadyDelayedCallbacks(err) {
    for (const c of this._readyDelayedCallbacks) {
      process.nextTick(c, err);
    }

    this._readyDelayedCallbacks = [];
  }

  /**
   * Check whether Cluster is able to process commands
   *
   * @param {Function} callback
   * @private
   */
  private readyCheck(callback: CallbackFunction<void | "fail">): void {
    (this as any).cluster("info", function (err, res) {
      if (err) {
        return callback(err);
      }
      if (typeof res !== "string") {
        return callback();
      }

      let state;
      const lines = res.split("\r\n");
      for (let i = 0; i < lines.length; ++i) {
        const parts = lines[i].split(":");
        if (parts[0] === "cluster_state") {
          state = parts[1];
          break;
        }
      }

      if (state === "fail") {
        debug("cluster state not ok (%s)", state);
        callback(null, state);
      } else {
        callback();
      }
    });
  }

  private resolveSrv(hostname: string): Promise<IRedisOptions> {
    return new Promise((resolve, reject) => {
      this.options.resolveSrv(hostname, (err, records) => {
        if (err) {
          return reject(err);
        }

        const self = this,
          groupedRecords = groupSrvRecords(records),
          sortedKeys = Object.keys(groupedRecords).sort(
            (a, b) => parseInt(a) - parseInt(b)
          );

        function tryFirstOne(err?) {
          if (!sortedKeys.length) {
            return reject(err);
          }

          const key = sortedKeys[0],
            group = groupedRecords[key],
            record = weightSrvRecords(group);

          if (!group.records.length) {
            sortedKeys.shift();
          }

          self.dnsLookup(record.name).then(
            (host) =>
              resolve({
                host,
                port: record.port,
              }),
            tryFirstOne
          );
        }

        tryFirstOne();
      });
    });
  }

  private dnsLookup(hostname: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.options.dnsLookup(hostname, (err, address) => {
        if (err) {
          debug(
            "failed to resolve hostname %s to IP: %s",
            hostname,
            err.message
          );
          reject(err);
        } else {
          debug("resolved hostname %s to IP %s", hostname, address);
          resolve(address);
        }
      });
    });
  }

  /**
   * Normalize startup nodes, and resolving hostnames to IPs.
   *
   * This process happens every time when #connect() is called since
   * #startupNodes and DNS records may chanage.
   *
   * @private
   * @returns {Promise<IRedisOptions[]>}
   */
  private resolveStartupNodeHostnames(): Promise<IRedisOptions[]> {
    if (!Array.isArray(this.startupNodes) || this.startupNodes.length === 0) {
      return Promise.reject(
        new Error("`startupNodes` should contain at least one node.")
      );
    }
    const startupNodes = normalizeNodeOptions(this.startupNodes);

    const hostnames = getUniqueHostnamesFromOptions(startupNodes);
    if (hostnames.length === 0) {
      return Promise.resolve(startupNodes);
    }

    return Promise.all(
      hostnames.map(
        (this.options.useSRVRecords ? this.resolveSrv : this.dnsLookup).bind(
          this
        )
      )
    ).then((configs) => {
      const hostnameToConfig = zipMap(hostnames, configs);

      return startupNodes.map((node) => {
        const config = hostnameToConfig.get(node.host);
        if (!config) {
          return node;
        } else if (this.options.useSRVRecords) {
          return Object.assign({}, node, config);
        } else {
          return Object.assign({}, node, { host: config });
        }
      });
    });
  }
}

Object.getOwnPropertyNames(Commander.prototype).forEach((name) => {
  if (!Cluster.prototype.hasOwnProperty(name)) {
    Cluster.prototype[name] = Commander.prototype[name];
  }
});

const scanCommands = [
  "sscan",
  "hscan",
  "zscan",
  "sscanBuffer",
  "hscanBuffer",
  "zscanBuffer",
];
scanCommands.forEach((command) => {
  Cluster.prototype[command + "Stream"] = function (key, options) {
    return new ScanStream(
      defaults(
        {
          objectMode: true,
          key: key,
          redis: this,
          command: command,
        },
        options
      )
    );
  };
});

require("../transaction").addTransactionSupport(Cluster.prototype);

export default Cluster;
