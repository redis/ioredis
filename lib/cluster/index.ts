import { exists, hasFlag } from "@ioredis/commands";
import { EventEmitter } from "events";
import { AbortError, RedisError } from "redis-errors";
import asCallback from "standard-as-callback";
import Command from "../Command";
import ClusterAllFailedError from "../errors/ClusterAllFailedError";
import Pipeline from "../Pipeline";
import Redis from "../Redis";
import ScanStream from "../ScanStream";
import { addTransactionSupport, Transaction } from "../transaction";
import { Callback, ScanStreamOptions, WriteableStream } from "../types";
import {
  CONNECTION_CLOSED_ERROR_MSG,
  Debug,
  defaults,
  noop,
  sample,
  shuffle,
  timeout,
  zipMap,
} from "../utils";
import applyMixin from "../utils/applyMixin";
import Commander from "../utils/Commander";
import { ClusterOptions, DEFAULT_CLUSTER_OPTIONS } from "./ClusterOptions";
import ClusterSubscriber from "./ClusterSubscriber";
import ConnectionPool from "./ConnectionPool";
import DelayQueue from "./DelayQueue";
import {
  getConnectionName, getNodeKey,
  getUniqueHostnamesFromOptions,
  groupSrvRecords,
  NodeKey,
  nodeKeyToRedisOptions,
  NodeRole,
  normalizeNodeOptions,
  RedisOptions,
  weightSrvRecords,
} from "./util";
import Deque = require("denque");
import ClusterSubscriberGroup from "./ClusterSubscriberGroup";

const debug = Debug("cluster");

const REJECT_OVERWRITTEN_COMMANDS = new WeakSet<Command>();

type OfflineQueueItem = {
  command: Command;
  stream: WriteableStream;
  node: unknown;
};

export type ClusterNode =
  | string
  | number
  | {
      host?: string | undefined;
      port?: number | undefined;
    };

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
 */
class Cluster extends Commander {
  options: ClusterOptions;
  slots: NodeKey[][] = [];
  status: ClusterStatus;

  /**
   * @ignore
   */
  _groupsIds: { [key: string]: number } = {};

  /**
   * @ignore
   */
  _groupsBySlot: number[] = Array(16384);

  /**
   * @ignore
   */
  isCluster = true;

  private startupNodes: (string | number | object)[];
  private connectionPool: ConnectionPool;
  private manuallyClosing: boolean;
  private retryAttempts = 0;
  private delayQueue: DelayQueue = new DelayQueue();
  private offlineQueue = new Deque<OfflineQueueItem>();
  private subscriber: ClusterSubscriber;
  private shardedSubscribers: ClusterSubscriberGroup;
  private slotsTimer: NodeJS.Timer;
  private reconnectTimeout: NodeJS.Timer;
  private isRefreshing = false;
  private _refreshSlotsCacheCallbacks = [];
  private _autoPipelines: Map<string, typeof Pipeline> = new Map();
  private _runningAutoPipelines: Set<string> = new Set();
  private _readyDelayedCallbacks: Callback[] = [];

  /**
   * Every time Cluster#connect() is called, this value will be
   * auto-incrementing. The purpose of this value is used for
   * discarding previous connect attampts when creating a new
   * connection.
   */
  private connectionEpoch = 0;

  /**
   * Creates an instance of Cluster.
   */
  //TODO: Add an option that enables or disables sharded PubSub
  constructor(startupNodes: ClusterNode[], options: ClusterOptions = {}) {
    super();
    EventEmitter.call(this);

    this.startupNodes = startupNodes;
    this.options = defaults({}, options, DEFAULT_CLUSTER_OPTIONS, this.options);

    if (this.options.shardedSubscribers == true)
      this.shardedSubscribers = new ClusterSubscriberGroup(this, this.refreshSlotsCache.bind(this));

    if (
      this.options.redisOptions &&
      this.options.redisOptions.keyPrefix &&
      !this.options.keyPrefix
    ) {
      this.options.keyPrefix = this.options.redisOptions.keyPrefix;
    }

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

    if (this.options.scripts) {
      Object.entries(this.options.scripts).forEach(([name, definition]) => {
        this.defineCommand(name, definition);
      });
    }

    if (this.options.lazyConnect) {
      this.setStatus("wait");
    } else {
      this.connect().catch((err) => {
        debug("connecting failed: %s", err);
      });
    }
  }

  /**
   * Connect to a cluster
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (
        this.status === "connecting" ||
        this.status === "connect" ||
        this.status === "ready"
      ) {
        reject(new Error("Redis is already connecting/connected"));
        return;
      }

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

          const readyHandler = () => {
            this.setStatus("ready");
            this.retryAttempts = 0;
            this.executeOfflineCommands();
            this.resetNodesRefreshInterval();
            resolve();
          };

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
                  readyHandler();
                }
              });
            } else {
              readyHandler();
            }
          };

          closeListener = () => {
            const error = new Error("None of startup nodes is available");

            this.removeListener("refresh", refreshListener);
            this.invokeReadyDelayedCallbacks(error);
            reject(error);
          };

          this.once("refresh", refreshListener);
          this.once("close", closeListener);
          this.once("close", this.handleCloseEvent.bind(this));

          this.refreshSlotsCache((err) => {
            if (err && err.message === ClusterAllFailedError.defaultMessage) {
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
   * Disconnect from every node in the cluster.
   */
  disconnect(reconnect = false) {
    const status = this.status;
    this.setStatus("disconnecting");

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
   */
  quit(callback?: Callback<"OK">): Promise<"OK"> {
    const status = this.status;
    this.setStatus("disconnecting");

    this.manuallyClosing = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.clearNodesRefreshInterval();

    this.subscriber.stop();

    if (this.options.shardedSubscribers) {
      this.shardedSubscribers.stop();
    }


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
   */
  duplicate(overrideStartupNodes = [], overrideOptions = {}) {
    const startupNodes =
      overrideStartupNodes.length > 0
        ? overrideStartupNodes
        : this.startupNodes.slice(0);
    const options = Object.assign({}, this.options, overrideOptions);
    return new Cluster(startupNodes, options);
  }

  /**
   * Get nodes with the specified role
   */
  nodes(role: NodeRole = "all"): Redis[] {
    if (role !== "all" && role !== "master" && role !== "slave") {
      throw new Error(
        'Invalid role "' + role + '". Expected "all", "master" or "slave"'
      );
    }
    return this.connectionPool.getNodes(role);
  }

  /**
   * This is needed in order not to install a listener for each auto pipeline
   *
   * @ignore
   */
  delayUntilReady(callback: Callback) {
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
   * Refresh the slot cache
   *
   * @ignore
   */
  refreshSlotsCache(callback?: Callback<void>): void {
    if (callback) {
      this._refreshSlotsCacheCallbacks.push(callback);
    }

    if (this.isRefreshing) {
      return;
    }
    
    this.isRefreshing = true;

    const _this = this;
    const wrapper = (error?: Error) => {
      this.isRefreshing = false;
      for (const callback of this._refreshSlotsCacheCallbacks) {
        callback(error);
      }
      this._refreshSlotsCacheCallbacks = [];
    };

    const nodes = shuffle(this.connectionPool.getNodes());

    let lastNodeError = null;

    function tryNode(index: number) {
      if (index === nodes.length) {
        const error = new ClusterAllFailedError(
          ClusterAllFailedError.defaultMessage,
          lastNodeError
        );
        return wrapper(error);
      }
      const node = nodes[index];
      const key = `${node.options.host}:${node.options.port}`;
      debug("getting slot cache from %s", key);
      _this.getInfoFromNode(node, function (err) {
        switch (_this.status) {
          case "close":
          case "end":
            return wrapper(new Error("Cluster is disconnected."));
          case "disconnecting":
            return wrapper(new Error("Cluster is disconnecting."));
        }
        if (err) {
          _this.emit("node error", err, key);
          lastNodeError = err;
          tryNode(index + 1);
        } else {
          _this.emit("refresh");
          wrapper();
        }
      });
    }

    tryNode(0);
  }

  /**
   * @ignore
   */
  sendCommand(command: Command, stream?: WriteableStream, node?: any): unknown {
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
    if (!node && !REJECT_OVERWRITTEN_COMMANDS.has(command)) {
      REJECT_OVERWRITTEN_COMMANDS.add(command);

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
          if (_this.options.shardedSubscribers == true &&
              (command.name == "ssubscribe" || command.name == "sunsubscribe")) {

            const sub: ClusterSubscriber = _this.shardedSubscribers.getResponsibleSubscriber(targetSlot);
            let status = -1;

            if (command.name == "ssubscribe")
              status = _this.shardedSubscribers.addChannels(command.getKeys());

            if ( command.name == "sunsubscribe")
              status = _this.shardedSubscribers.removeChannels(command.getKeys());

            if (status !== -1) {
              redis = sub.getInstance();
            } else {
              command.reject(new AbortError("Can't add or remove the given channels. Are they in the same slot?"));
            }
          }
          else {
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
                let key: string;
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

  sscanStream(key: string, options?: ScanStreamOptions) {
    return this.createScanStream("sscan", { key, options });
  }

  sscanBufferStream(key: string, options?: ScanStreamOptions) {
    return this.createScanStream("sscanBuffer", { key, options });
  }

  hscanStream(key: string, options?: ScanStreamOptions) {
    return this.createScanStream("hscan", { key, options });
  }

  hscanBufferStream(key: string, options?: ScanStreamOptions) {
    return this.createScanStream("hscanBuffer", { key, options });
  }

  zscanStream(key: string, options?: ScanStreamOptions) {
    return this.createScanStream("zscan", { key, options });
  }

  zscanBufferStream(key: string, options?: ScanStreamOptions) {
    return this.createScanStream("zscanBuffer", { key, options });
  }

  /**
   * @ignore
   */
  handleError(error: Error, ttl: { value?: any }, handlers) {
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

  private resetOfflineQueue() {
    this.offlineQueue = new Deque();
  }

  private clearNodesRefreshInterval() {
    if (this.slotsTimer) {
      clearTimeout(this.slotsTimer);
      this.slotsTimer = null;
    }
  }

  private resetNodesRefreshInterval() {
    if (this.slotsTimer || !this.options.slotsRefreshInterval) {
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
   * Change cluster instance's status
   */
  private setStatus(status: ClusterStatus): void {
    debug("status: %s -> %s", this.status || "[empty]", status);
    this.status = status;
    process.nextTick(() => {
      this.emit(status);
    });
  }

  /**
   * Called when closed to check whether a reconnection should be made
   */
  private handleCloseEvent(reason?: Error): void {
    if (reason) {
      debug("closed because %s", reason);
    }

    let retryDelay: unknown;
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
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        debug("Cluster is disconnected. Retrying after %dms", retryDelay);
        this.connect().catch(function (err) {
          debug("Got error %s when reconnecting. Ignoring...", err);
        });
      }, retryDelay);
    } else {
      this.setStatus("end");
      this.flushQueue(new Error("None of startup nodes is available"));
    }
  }

  /**
   * Flush offline queue with error.
   */
  private flushQueue(error: Error) {
    let item: OfflineQueueItem;
    while ((item = this.offlineQueue.shift())) {
      item.command.reject(error);
    }
  }

  private executeOfflineCommands() {
    if (this.offlineQueue.length) {
      debug("send %d commands in offline queue", this.offlineQueue.length);
      const offlineQueue = this.offlineQueue;
      this.resetOfflineQueue();
      let item: OfflineQueueItem;
      while ((item = offlineQueue.shift())) {
        this.sendCommand(item.command, item.stream, item.node);
      }
    }
  }

  private natMapper(nodeKey: NodeKey | RedisOptions): RedisOptions {
    const key =
      typeof nodeKey === "string"
        ? nodeKey
        : `${nodeKey.host}:${nodeKey.port}`;

    let mapped = null;
    if (this.options.natMap && typeof this.options.natMap === "function") {
      mapped = this.options.natMap(key);
    } else if (this.options.natMap && typeof this.options.natMap === "object") {
      mapped = this.options.natMap[key];
    }

    if (mapped) {
      debug("NAT mapping %s -> %O", key, mapped);
      return Object.assign({}, mapped);
    }

    return typeof nodeKey === "string"
      ? nodeKeyToRedisOptions(nodeKey)
      : nodeKey;
  }

  private getInfoFromNode(redis: Redis, callback: Callback<void>) {
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
      "SLOTS",
      timeout((err: Error, result) => {
        duplicatedConnection.disconnect();
        if (err) {
          debug("error encountered running CLUSTER.SLOTS: %s", err);
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
        const nodes: RedisOptions[] = [];

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
            const node = this.natMapper({
              host: items[j][0],
              port: items[j][1],
            });
            node.readOnly = j !== 2;
            nodes.push(node);
            keys.push(node.host + ":" + node.port);
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

  private invokeReadyDelayedCallbacks(err?: Error) {
    for (const c of this._readyDelayedCallbacks) {
      process.nextTick(c, err);
    }

    this._readyDelayedCallbacks = [];
  }

  /**
   * Check whether Cluster is able to process commands
   */
  private readyCheck(callback: Callback<void | "fail">): void {
    this.cluster("INFO", (err, res) => {
      if (err) {
        return callback(err);
      }
      if (typeof res !== "string") {
        return callback();
      }

      let state: string;
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

  private resolveSrv(hostname: string): Promise<RedisOptions> {
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
   */
  private async resolveStartupNodeHostnames(): Promise<RedisOptions[]> {
    if (!Array.isArray(this.startupNodes) || this.startupNodes.length === 0) {
      throw new Error("`startupNodes` should contain at least one node.");
    }
    const startupNodes = normalizeNodeOptions(this.startupNodes);

    const hostnames = getUniqueHostnamesFromOptions(startupNodes);
    if (hostnames.length === 0) {
      return startupNodes;
    }

    const configs = await Promise.all(
      hostnames.map(
        (this.options.useSRVRecords ? this.resolveSrv : this.dnsLookup).bind(
          this
        )
      )
    );
    const hostnameToConfig = zipMap(hostnames, configs);

    return startupNodes.map((node) => {
      const config = hostnameToConfig.get(node.host);
      if (!config) {
        return node;
      }
      if (this.options.useSRVRecords) {
        return Object.assign({}, node, config);
      }
      return Object.assign({}, node, { host: config });
    });
  }

  private createScanStream(
    command: string,
    { key, options = {} }: { key?: string; options?: ScanStreamOptions }
  ) {
    return new ScanStream({
      objectMode: true,
      key: key,
      redis: this,
      command: command,
      ...options,
    });
  }
}

interface Cluster extends EventEmitter {}
applyMixin(Cluster, EventEmitter);

addTransactionSupport(Cluster.prototype);
interface Cluster extends Transaction {}

export default Cluster;
