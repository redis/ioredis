import { exists, hasFlag } from "@ioredis/commands";
import { EventEmitter } from "events";
import asCallback from "standard-as-callback";
import Cluster from "./cluster";
import Command from "./Command";
import DataHandler, {
  COMMAND_QUEUE_DRAINED,
  DataHandledable,
  FlushQueueOptions,
  Condition,
} from "./DataHandler";
import { StandaloneConnector } from "./connectors";
import AbstractConnector from "./connectors/AbstractConnector";
import SentinelConnector from "./connectors/SentinelConnector";
import * as eventHandler from "./redis/event_handler";
import {
  DEFAULT_REDIS_OPTIONS,
  ReconnectOnError,
  RedisOptions,
} from "./redis/RedisOptions";
import ScanStream from "./ScanStream";
import { addTransactionSupport, Transaction } from "./transaction";
import {
  Callback,
  CommandItem,
  NetStream,
  ProtocolVersion,
  ReplyMappingFromOptions,
  ReplyMappingMode,
  ScanStreamOptions,
  WriteableStream,
} from "./types";
import {
  CONNECTION_CLOSED_ERROR_MSG,
  Debug,
  isInt,
  isResp2SubscriberMode,
  parseURL,
  resolveTLSProfile,
} from "./utils";
import { WatchError } from "./errors";
import {
  traceCommand,
  traceConnect,
  sanitizeArgs,
  type CommandTraceContext,
  type BatchOperationContext,
} from "./tracing";
import applyMixin from "./utils/applyMixin";
import Commander from "./utils/Commander";
import { defaults, noop } from "./utils/lodash";
import HimportCoordinator, {
  bindHimportCoordinator,
  getHimportBinding,
  hasHimportCoordinator,
  interceptHimportCommand,
  isInternalHimportCommand,
} from "./himport/HimportCoordinator";
import MaintenanceManager, {
  MaintenanceClient,
} from "./maintNotifications/MaintenanceManager";
import {
  DetachedTransport,
  HandoffCandidate,
  HandoffEndpoint,
} from "./redis/ConnectionSession";
import { cloneHimportFieldsets } from "./himport/HimportCoordinator";
import Deque = require("denque");
const debug = Debug("redis");

export type RedisStatus =
  | "wait"
  | "reconnecting"
  | "connecting"
  | "connect"
  | "ready"
  | "close"
  | "end";

/**
 * This is the major component of ioredis.
 * Use it to connect to a standalone Redis server or Sentinels.
 *
 * ```typescript
 * const redis = new Redis(); // Default port is 6379
 * async function main() {
 *   redis.set("foo", "bar");
 *   redis.get("foo", (err, result) => {
 *     // `result` should be "bar"
 *     console.log(err, result);
 *   });
 *   // Or use Promise
 *   const result = await redis.get("foo");
 * }
 * ```
 */
class Redis<ReplyMapping extends ReplyMappingMode = "legacy">
  extends Commander<{
    type: "default";
    mapping: ReplyMapping extends "resp3" ? "resp3" : "resp2";
  }>
  implements DataHandledable
{
  static Cluster = Cluster;
  static Command = Command;
  /**
   * Default options
   */
  private static defaultOptions = DEFAULT_REDIS_OPTIONS;

  /**
   * Create a Redis instance.
   * This is the same as `new Redis()` but is included for compatibility with node-redis.
   */
  static createClient(...args: ConstructorParameters<typeof Redis>): Redis {
    return new Redis(...args);
  }

  options: RedisOptions;
  status: RedisStatus = "wait";

  /**
   * @ignore
   */
  stream: NetStream;

  /**
   * @ignore
   */
  isCluster = false;

  /**
   * @ignore
   */
  condition: Condition | null;

  /**
   * @ignore
   */
  commandQueue: Deque<CommandItem>;

  private connector: AbstractConnector;
  private maintenanceManager: MaintenanceManager | null = null;
  // Set when a Smart Client Handoff replaces the connection while a WATCH is
  // active on it. The server-side watch set dies with the old connection, so
  // the next MULTI/EXEC must abort with WatchError instead of executing
  // unguarded. Cleared when a transaction is rejected or when UNWATCH, EXEC,
  // DISCARD, or RESET resets the watch state.
  private staleWatch = false;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private offlineQueue: Deque;
  private connectionEpoch = 0;
  private retryAttempts = 0;
  private manuallyClosing = false;
  private socketTimeoutTimer: NodeJS.Timeout | undefined;
  private [hasHimportCoordinator] = false;

  // Prepare autopipelines structures
  private _autoPipelines = new Map();
  private _runningAutoPipelines = new Set();

  // The `replyMapping` intersection on the options-bearing overloads lets the
  // `ReplyMapping` class type parameter be inferred from the literal passed at
  // construction time (e.g. `new Redis({ protocol: 3, replyMapping: "resp3" })`),
  // which in turn selects the RESP3 return shapes via `Resp3<...>`. Omitting it
  // (or passing "legacy") keeps the default RESP2 shapes.
  constructor(
    port: number,
    host: string,
    options: RedisOptions & { replyMapping?: ReplyMapping }
  );
  constructor(
    path: string,
    options: RedisOptions & { replyMapping?: ReplyMapping }
  );
  constructor(
    port: number,
    options: RedisOptions & { replyMapping?: ReplyMapping }
  );
  constructor(port: number, host: string);
  constructor(options: RedisOptions & { replyMapping?: ReplyMapping });
  constructor(port: number);
  constructor(path: string);
  constructor();
  constructor(arg1?: unknown, arg2?: unknown, arg3?: unknown) {
    super();
    this.parseOptions(arg1, arg2, arg3);

    EventEmitter.call(this);

    this.options.himportFieldsets = cloneHimportFieldsets(
      this.options.himportFieldsets
    );
    if (this.options.himportFieldsets?.length) {
      bindHimportCoordinator(
        this,
        new HimportCoordinator(this.options.himportFieldsets),
        "standalone"
      );
    }

    if (this.options.maintNotifications !== "disabled") {
      this.maintenanceManager = new MaintenanceManager(
        this as unknown as MaintenanceClient
      );
      // A dropped connection implicitly ends every maintenance window and
      // write pause: if maintenance is still ongoing, the server re-sends
      // the pending notification on the next connection, and the ordinary
      // reconnect path replays the offline queue.
      this.on("close", () => {
        // A connection lost while a maintenance window is open takes an
        // active WATCH with it — servers drop connections while migrating a
        // shard, and hard-close at the end of an endpointless MOVING grace
        // period. Record the loss before the windows reset so the next
        // transaction aborts instead of executing unguarded.
        if (
          this.condition?.watching &&
          this.maintenanceManager?.isMaintenanceActive()
        ) {
          debug(
            "connection loss during maintenance invalidates an active WATCH"
          );
          this.staleWatch = true;
        }
        this.maintenanceManager?.reset();
      });
    }

    this.resetCommandQueue();
    this.resetOfflineQueue();

    if (this.options.Connector) {
      this.connector = new this.options.Connector(this.options);
    } else if (this.options.sentinels) {
      const sentinelConnector = new SentinelConnector(this.options);
      sentinelConnector.emitter = this;

      this.connector = sentinelConnector;
    } else {
      this.connector = new StandaloneConnector(this.options);
    }

    if (this.options.scripts) {
      Object.entries(this.options.scripts).forEach(([name, definition]) => {
        this.defineCommand(name, definition);
      });
    }

    // end(or wait) -> connecting -> connect -> ready -> end
    if (this.options.lazyConnect) {
      this.setStatus("wait");
    } else {
      this.connect().catch(noop);
    }
  }

  get autoPipelineQueueSize() {
    let queued = 0;

    for (const pipeline of this._autoPipelines.values()) {
      queued += pipeline.length;
    }

    return queued;
  }

  /**
   * Create a connection to Redis.
   * This method will be invoked automatically when creating a new Redis instance
   * unless `lazyConnect: true` is passed.
   *
   * When calling this method manually, a Promise is returned, which will
   * be resolved when the connection status is ready. The promise can reject
   * if the connection fails, times out, or if Redis is already connecting/connected.
   */
  connect(callback?: Callback<void>): Promise<void> {
    const promise = traceConnect(
      () => this._connect(),
      () => {
        const { address, port } = this._getServerAddress();
        return {
          serverAddress: address,
          serverPort: port,
          connectionEpoch: this.connectionEpoch,
        };
      }
    );

    return asCallback(promise, callback);
  }

  private _connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (
        this.status === "connecting" ||
        this.status === "connect" ||
        this.status === "ready"
      ) {
        reject(new Error("Redis is already connecting/connected"));
        return;
      }

      this.connectionEpoch += 1;
      this.setStatus("connecting");

      const { options } = this;

      this.condition = {
        select: options.db,
        auth: options.username
          ? [options.username, options.password]
          : options.password,
        subscriber: false,
        protocol: options.protocol as ProtocolVersion,
        replyMapping:
          options.protocol === 3 && options.replyMapping === "resp3"
            ? "resp3"
            : "legacy",
        handshake: false,
        watching: false,
      };

      const _this = this;
      asCallback(
        this.connector.connect(function (type, err) {
          _this.silentEmit(type, err);
        }) as Promise<NetStream>,
        function (err: Error | null, stream?: NetStream) {
          if (err) {
            _this.flushQueue(err);
            _this.silentEmit("error", err);
            reject(err);
            _this.setStatus("end");
            return;
          }
          let CONNECT_EVENT = options.tls ? "secureConnect" : "connect";
          if (
            "sentinels" in options &&
            options.sentinels &&
            !options.enableTLSForSentinelMode
          ) {
            CONNECT_EVENT = "connect";
          }

          _this.stream = stream;

          if (options.noDelay) {
            stream.setNoDelay(true);
          }

          // Node ignores setKeepAlive before connect, therefore we wait for the event:
          // https://github.com/nodejs/node/issues/31663
          if (typeof options.keepAlive === "number") {
            if (stream.connecting) {
              stream.once(CONNECT_EVENT, () => {
                stream.setKeepAlive(true, options.keepAlive);
              });
            } else {
              stream.setKeepAlive(true, options.keepAlive);
            }
          }

          if (stream.connecting) {
            stream.once(CONNECT_EVENT, eventHandler.connectHandler(_this));

            if (options.connectTimeout) {
              /*
               * Typically, Socket#setTimeout(0) will clear the timer
               * set before. However, in some platforms (Electron 3.x~4.x),
               * the timer will not be cleared. So we introduce a variable here.
               *
               * See https://github.com/electron/electron/issues/14915
               */
              let connectTimeoutCleared = false;
              stream.setTimeout(options.connectTimeout, function () {
                if (connectTimeoutCleared) {
                  return;
                }
                stream.setTimeout(0);
                stream.destroy();

                const err = new Error("connect ETIMEDOUT");
                // @ts-expect-error
                err.errorno = "ETIMEDOUT";
                // @ts-expect-error
                err.code = "ETIMEDOUT";
                // @ts-expect-error
                err.syscall = "connect";
                eventHandler.errorHandler(_this)(err);
              });
              stream.once(CONNECT_EVENT, function () {
                connectTimeoutCleared = true;
                stream.setTimeout(0);
              });
            }
          } else if (stream.destroyed) {
            const firstError = _this.connector.firstError;
            if (firstError) {
              process.nextTick(() => {
                eventHandler.errorHandler(_this)(firstError);
              });
            }
            process.nextTick(eventHandler.closeHandler(_this));
          } else {
            process.nextTick(eventHandler.connectHandler(_this));
          }
          if (!stream.destroyed) {
            stream.once("error", eventHandler.errorHandler(_this));
            stream.once("close", eventHandler.closeHandler(_this));
          }

          const connectionReadyHandler = function () {
            _this.removeListener("close", connectionCloseHandler);
            resolve();
          };
          var connectionCloseHandler = function () {
            _this.removeListener("ready", connectionReadyHandler);
            reject(new Error(CONNECTION_CLOSED_ERROR_MSG));
          };
          _this.once("ready", connectionReadyHandler);
          _this.once("close", connectionCloseHandler);
        }
      );
    });
  }

  /**
   * Disconnect from Redis.
   *
   * This method closes the connection immediately,
   * and may lose some pending replies that haven't written to client.
   * If you want to wait for the pending replies, use Redis#quit instead.
   */
  disconnect(reconnect = false) {
    if (!reconnect) {
      this.manuallyClosing = true;
    }
    if (this.reconnectTimeout && !reconnect) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.status === "wait") {
      eventHandler.closeHandler(this)();
    } else {
      this.connector.disconnect();
    }
  }

  /**
   * Disconnect from Redis.
   *
   * @deprecated
   */
  end() {
    this.disconnect();
  }

  /**
   * Create a new instance with the same options as the current one.
   *
   * @example
   * ```js
   * var redis = new Redis(6380);
   * var anotherRedis = redis.duplicate();
   * ```
   */
  duplicate<Override extends Partial<RedisOptions> | undefined = undefined>(
    override?: Override
  ): Redis<ReplyMappingFromOptions<ReplyMapping, Override>> {
    return new Redis({
      ...this.options,
      ...(override ?? {}),
    }) as Redis<ReplyMappingFromOptions<ReplyMapping, Override>>;
  }

  /**
   * Mode of the connection.
   *
   * One of `"normal"`, `"subscriber"`, or `"monitor"`. When the connection is
   * not in `"normal"` mode, certain commands are not allowed.
   */
  get mode(): "normal" | "subscriber" | "monitor" {
    return this.options.monitor
      ? "monitor"
      : isResp2SubscriberMode(this.condition)
      ? "subscriber"
      : "normal";
  }

  /**
   * Listen for all requests received by the server in real time.
   *
   * This command will create a new connection to Redis and send a
   * MONITOR command via the new connection in order to avoid disturbing
   * the current connection.
   *
   * @param callback The callback function. If omit, a promise will be returned.
   * @example
   * ```js
   * var redis = new Redis();
   * redis.monitor(function (err, monitor) {
   *   // Entering monitoring mode.
   *   monitor.on('monitor', function (time, args, source, database) {
   *     console.log(time + ": " + util.inspect(args));
   *   });
   * });
   *
   * // supports promise as well as other commands
   * redis.monitor().then(function (monitor) {
   *   monitor.on('monitor', function (time, args, source, database) {
   *     console.log(time + ": " + util.inspect(args));
   *   });
   * });
   * ```
   */
  monitor(callback?: Callback<Redis>): Promise<Redis> {
    const monitorInstance = this.duplicate({
      monitor: true,
      lazyConnect: false,
      himportFieldsets: undefined,
    });

    return asCallback(
      new Promise(function (resolve, reject) {
        monitorInstance.once("error", reject);
        monitorInstance.once("monitoring", function () {
          resolve(monitorInstance);
        });
      }),
      callback
    );
  }

  /**
   * Send a command to Redis
   *
   * This method is used internally and in most cases you should not
   * use it directly. If you need to send a command that is not supported
   * by the library, you can use the `call` method:
   *
   * ```js
   * const redis = new Redis();
   *
   * redis.call('set', 'foo', 'bar');
   * // or
   * redis.call(['set', 'foo', 'bar']);
   * ```
   *
   * @ignore
   */
  sendCommand(command: Command, stream?: WriteableStream): unknown {
    command.setReplyContext(this.condition ?? this.options);

    if (this.status === "wait") {
      this.connect().catch(noop);
    }
    if (this.status === "end") {
      command.reject(new Error(CONNECTION_CLOSED_ERROR_MSG));
      return command.promise;
    }
    if (
      isResp2SubscriberMode(this.condition) &&
      !Command.checkFlag("VALID_IN_SUBSCRIBER_MODE", command.name)
    ) {
      command.reject(
        new Error(
          "Connection in subscriber mode, only subscriber commands may be used"
        )
      );
      return command.promise;
    }

    // A Smart Client Handoff replaced the connection while a WATCH was
    // active, so the server-side watch set is gone. Reject the transaction
    // before anything is written — a MULTI batch is rejected as a whole so
    // the server never sees a partial transaction — and scrub the watch
    // state so a retried transaction starts fresh.
    if (this.staleWatch && this.isStaleWatchTransaction(command, stream)) {
      if (!stream || command.name.toLowerCase() === "exec") {
        this.scrubStaleWatch();
      }
      command.reject(new WatchError());
      return command.promise;
    }

    if (typeof this.options.commandTimeout === "number") {
      const policy = this.maintenanceManager?.commandTimeoutPolicy();
      if (policy) {
        command.setTimeout(policy.timeout, policy.createTimeoutError);
        // A command re-entering sendCommand (e.g. resent from
        // prevCommandQueue after a reconnect) already has a running timer,
        // making setTimeout() a no-op; extend its deadline instead.
        command.extendTimeout(policy.timeout, policy.createTimeoutError);
      } else {
        command.setTimeout(this.options.commandTimeout);
      }
    }

    if (
      !stream &&
      this[hasHimportCoordinator] &&
      interceptHimportCommand(this, command, this.status === "ready", () => {
        this.sendCommand(command);
      })
    ) {
      return command.promise;
    }

    const blockingTimeout = this.getBlockingTimeoutInMs(command);

    let writable =
      // While writes are paused for a connection handoff, every command is
      // retained in the offline queue and replayed after the handoff settles.
      !this.maintenanceManager?.isWritePaused() &&
      (this.status === "ready" ||
        // During handshake, only internal handshake commands may bypass the queue.
        (!stream &&
          this.status === "connect" &&
          this.condition?.handshake &&
          (Command.checkFlag("HANDSHAKE_COMMANDS", command.name) ||
            isInternalHimportCommand(command))) ||
        // Before ready, loading-safe commands remain writable after handshake.
        (!stream &&
          this.status === "connect" &&
          !this.condition?.handshake &&
          exists(command.name, { caseInsensitive: true }) &&
          hasFlag(command.name, "loading", { nameCaseInsensitive: true })));
    if (!this.stream) {
      writable = false;
    } else if (!this.stream.writable) {
      writable = false;
      // @ts-expect-error
    } else if (this.stream._writableState && this.stream._writableState.ended) {
      // TODO: We should be able to remove this as the PR has already been merged.
      // https://github.com/iojs/io.js/pull/1217
      writable = false;
    }

    if (!writable) {
      if (!this.options.enableOfflineQueue) {
        command.reject(
          new Error(
            this.maintenanceManager?.isWritePaused()
              ? "Command cannot be queued during a connection handoff because enableOfflineQueue is false"
              : "Stream isn't writeable and enableOfflineQueue options is false"
          )
        );
        return command.promise;
      }

      if (command.name === "quit" && this.offlineQueue.length === 0) {
        this.disconnect();
        command.resolve(Buffer.from("OK"));
        return command.promise;
      }

      // @ts-expect-error
      if (debug.enabled) {
        debug(
          "queue command[%s]: %d -> %s(%o)",
          this._getDescription(),
          this.condition.select,
          command.name,
          command.args
        );
      }

      this.offlineQueue.push({
        command: command,
        stream: stream,
        select: this.condition.select,
      });

      // For blocking commands in the offline queue, arm a client-side timeout
      // only when blockingTimeout is configured. Without this option, queued
      // blocking commands may wait indefinitely on a dead connection.
      if (Command.checkFlag("BLOCKING_COMMANDS", command.name)) {
        const offlineTimeout = this.getConfiguredBlockingTimeout();
        if (offlineTimeout !== undefined) {
          command.setBlockingTimeout(offlineTimeout);
        }
      }
    } else {
      // @ts-expect-error
      if (debug.enabled) {
        debug(
          "write command[%s]: %d -> %s(%o)",
          this._getDescription(),
          this.condition?.select,
          command.name,
          command.args
        );
      }

      if (stream) {
        if ("isPipeline" in stream && stream.isPipeline) {
          stream.write(command.toWritable(stream.destination.redis.stream));
        } else {
          stream.write(command.toWritable(stream));
        }
      } else {
        this.stream.write(command.toWritable(this.stream));
      }

      this.commandQueue.push({
        command: command,
        stream: stream,
        select: this.condition.select,
      });

      this.trackWatchState(command);

      if (blockingTimeout !== undefined) {
        command.setBlockingTimeout(blockingTimeout);
      }

      if (Command.checkFlag("WILL_DISCONNECT", command.name)) {
        this.manuallyClosing = true;
      }

      if (
        this.options.socketTimeout !== undefined &&
        this.socketTimeoutTimer === undefined
      ) {
        this.setSocketTimeout();
      }
    }

    if (command.name === "select" && isInt(command.args[0])) {
      const db = parseInt(command.args[0], 10);
      if (this.condition.select !== db) {
        this.condition.select = db;
        this.emit("select", db);
        debug("switch to db [%d]", this.condition.select);
      }
    }

    if (!writable || command.isTraced) {
      return command.promise;
    }

    // Trace on the write path only, and only once per command. Commands may
    // pass through sendCommand multiple times (offline queue flush,
    // prevCommandQueue resend after reconnect). The isTraced flag ensures
    // we don't emit duplicate trace events.
    command.isTraced = true;
    return traceCommand(
      () => command.promise as Promise<unknown>,
      () => this._buildCommandContext(command)
    );
  }

  /**
   * Whether this command belongs to a MULTI/EXEC transaction that must abort
   * because its WATCH was invalidated by a connection handoff. A pipelined
   * batch that wraps MULTI is matched command-by-command so the whole batch
   * is rejected uniformly and nothing reaches the wire; standalone MULTI and
   * EXEC cover the `multi({ pipeline: false })` flow.
   */
  private isStaleWatchTransaction(
    command: Command,
    stream?: WriteableStream
  ): boolean {
    if (stream) {
      return "isPipeline" in stream && Boolean(stream.containsMulti);
    }
    const name = command.name.toLowerCase();
    return name === "multi" || name === "exec";
  }

  /**
   * Clears an invalidated watch and sends UNWATCH so any watches established
   * after the handoff are dropped too — a retried transaction starts from a
   * pristine watch state.
   */
  private scrubStaleWatch(): void {
    this.staleWatch = false;
    this.unwatch().catch(noop);
  }

  /**
   * Mirrors the server-side watch state of the connection a written command
   * leaves behind, so a handoff can tell whether it invalidates a WATCH.
   */
  private trackWatchState(command: Command): void {
    if (!this.condition) {
      return;
    }

    switch (command.name.toLowerCase()) {
      case "watch":
        // WATCH queued inside MULTI is rejected by the server and never
        // establishes a watch; any other WATCH does — including one issued
        // before MULTI or after an inline EXEC within a pipeline batch.
        if (!command.inTransaction) {
          this.condition.watching = true;
        }
        break;
      case "unwatch":
      case "exec":
      case "discard":
      case "reset":
        // Each of these clears the server-side watch set, which also
        // resolves a watch invalidated by a handoff.
        this.condition.watching = false;
        this.staleWatch = false;
        break;
    }
  }

  private getBlockingTimeoutInMs(command: Command): number | undefined {
    if (!Command.checkFlag("BLOCKING_COMMANDS", command.name)) {
      return undefined;
    }

    // Feature is opt-in: only enabled when blockingTimeout is set to a positive number
    const configuredTimeout = this.getConfiguredBlockingTimeout();
    if (configuredTimeout === undefined) {
      return undefined;
    }

    const timeout = command.extractBlockingTimeout();
    if (typeof timeout === "number") {
      if (timeout > 0) {
        // Finite timeout from command args - add grace period
        return (
          timeout +
          (this.options.blockingTimeoutGrace ??
            DEFAULT_REDIS_OPTIONS.blockingTimeoutGrace)
        );
      }
      // Command has timeout=0 (block forever), use blockingTimeout option as safety net
      return configuredTimeout;
    }

    if (timeout === null) {
      // No BLOCK option found (e.g., XREAD without BLOCK), use blockingTimeout as safety net
      return configuredTimeout;
    }

    return undefined;
  }

  private getConfiguredBlockingTimeout(): number | undefined {
    if (
      typeof this.options.blockingTimeout === "number" &&
      this.options.blockingTimeout > 0
    ) {
      return this.options.blockingTimeout;
    }

    return undefined;
  }

  private setSocketTimeout() {
    const stream = this.stream;
    this.armSocketTimeout();

    // this handler must run after the "data" handler in "DataHandler"
    // so that `this.commandQueue.length` will be updated
    stream.once("data", () => {
      clearTimeout(this.socketTimeoutTimer);
      this.socketTimeoutTimer = undefined;
      if (this.commandQueue.length === 0) return;
      this.setSocketTimeout();
    });
  }

  /**
   * Arms only the timer, deliberately without registering another "data"
   * listener, so a pending timeout can be rescheduled (e.g. relaxed for
   * maintenance) without stacking listeners in setSocketTimeout().
   */
  private armSocketTimeout() {
    const stream = this.stream;
    const policy = this.maintenanceManager?.socketTimeoutPolicy() ?? null;
    const timeout = policy ? policy.timeout : this.options.socketTimeout;

    this.socketTimeoutTimer = setTimeout(() => {
      stream.destroy(
        policy
          ? policy.createTimeoutError()
          : new Error(
              `Socket timeout. Expecting data, but didn't receive any in ${timeout}ms.`
            )
      );
      this.socketTimeoutTimer = undefined;
    }, timeout);
  }

  /**
   * Extends the deadline of every pending command (written or still queued)
   * so none expires earlier than `timeout` from now. Driven by the
   * maintenance manager when a maintenance window opens.
   */
  private extendPendingCommandTimeouts(
    timeout: number,
    createTimeoutError: () => Error
  ): void {
    for (const item of this.commandQueue.toArray()) {
      item.command.extendTimeout?.(timeout, createTimeoutError);
    }
    for (const item of this.offlineQueue.toArray()) {
      item.command.extendTimeout?.(timeout, createTimeoutError);
    }
  }

  /**
   * Reschedules a pending socket timeout so the next arm picks up the
   * current timeout policy. Driven by the maintenance manager when a
   * maintenance window opens or the last one closes.
   */
  private rearmSocketTimeout(): void {
    if (this.socketTimeoutTimer === undefined) {
      return;
    }

    clearTimeout(this.socketTimeoutTimer);
    this.socketTimeoutTimer = undefined;
    this.armSocketTimeout();
  }

  /**
   * Replays the offline queue through sendCommand. Shared by the ready
   * handler after a (re)connect and by the maintenance manager after a
   * handoff write pause is resumed.
   */
  private flushOfflineQueue(): void {
    if (
      this.maintenanceManager?.isWritePaused() ||
      this.offlineQueue.length === 0
    ) {
      return;
    }

    debug("send %d commands in offline queue", this.offlineQueue.length);
    const offlineQueue = this.offlineQueue;
    this.resetOfflineQueue();
    while (offlineQueue.length > 0) {
      const item = offlineQueue.shift();
      if (
        item.select !== this.condition.select &&
        item.command.name !== "select"
      ) {
        this.select(item.select);
      }
      this.sendCommand(item.command, item.stream);
    }
  }

  /**
   * Whether this connection's shape supports a Smart Client Handoff.
   * Subscriber and monitor connections carry state a fresh candidate would
   * lose, and a client without a retry strategy manages its own connection
   * lifecycle (Cluster-owned node clients set retryStrategy to null); all of
   * those fall back to the ordinary reconnect path.
   */
  private canHandoffConnection(): boolean {
    return (
      this.mode === "normal" &&
      !this.condition?.subscriber &&
      typeof this.options.retryStrategy === "function"
    );
  }

  /**
   * The endpoint this client is configured against, used as the handoff
   * target when an endpointless MOVING asks for a reconnect against the
   * (re-resolved) configured address. Null for connections a handoff cannot
   * be established for: socket paths, Sentinel, and custom connectors.
   */
  private getConfiguredEndpoint(): HandoffEndpoint | null {
    if (
      this.options.sentinels ||
      this.options.Connector ||
      ("path" in this.options && this.options.path)
    ) {
      return null;
    }

    const { host, port } = this.options;
    if (typeof host !== "string" || typeof port !== "number") {
      return null;
    }
    return { host, port };
  }

  /**
   * Establishes a fully handshaken connection to the given endpoint through
   * a temporary duplicate client. The temporary client keeps owning (and
   * monitoring) the socket until `detachTransport()` is called at the
   * adoption moment, so a failing candidate can never raise an unhandled
   * error event. The temporary client never reconnects on its own.
   */
  private async createCandidateConnection(
    endpoint: HandoffEndpoint
  ): Promise<HandoffCandidate> {
    if (
      this.options.sentinels ||
      this.options.Connector ||
      ("path" in this.options && this.options.path)
    ) {
      throw new Error(
        "Connection handoff is only supported for standalone TCP connections"
      );
    }

    const candidate = this.duplicate({
      host: endpoint.host,
      port: endpoint.port,
      // The candidate must land on the database the connection actually
      // uses, which a runtime SELECT may have changed from options.db.
      db: this.condition?.select ?? this.options.db,
      lazyConnect: true,
      retryStrategy: null,
      reconnectOnError: null,
      himportFieldsets: undefined,
    });
    // A candidate failure is handled through the handoff flow; keep its
    // error events from being reported as unhandled.
    candidate.on("error", noop);

    try {
      await candidate.connect();
    } catch (err) {
      candidate.disconnect();
      throw err;
    }

    return {
      detachTransport: () => candidate.detachReadyTransport(),
      dispose: () => {
        if (candidate.status !== "end") {
          candidate.disconnect();
        }
      },
    };
  }

  /**
   * Detaches this client's transport so another client can adopt it. Only a
   * ready, idle connection in normal mode can be detached; afterwards this
   * client is permanently ended and every listener it registered on the
   * stream is removed.
   */
  private detachReadyTransport(): DetachedTransport {
    if (
      this.status !== "ready" ||
      this.mode !== "normal" ||
      this.commandQueue.length > 0 ||
      this.offlineQueue.length > 0 ||
      !this.condition
    ) {
      throw new Error(
        "Only a ready and idle candidate connection can be detached"
      );
    }

    const transport: DetachedTransport = {
      stream: this.stream,
      connector: this.connector,
      condition: this.condition,
    };

    // Strip everything this client registered on the socket so no callback
    // can reach a client that no longer owns the connection.
    transport.stream.removeAllListeners("data");
    transport.stream.removeAllListeners("error");
    transport.stream.removeAllListeners("close");
    if (this.socketTimeoutTimer !== undefined) {
      clearTimeout(this.socketTimeoutTimer);
      this.socketTimeoutTimer = undefined;
    }

    // Sever ownership so disposing this client cannot touch the socket, and
    // end it so it rejects any further use.
    this.stream = undefined as unknown as NetStream;
    this.connector = undefined as unknown as AbstractConnector;
    this.manuallyClosing = true;
    this.setStatus("end");

    return transport;
  }

  /**
   * Atomically replaces this client's transport with an adopted one. The
   * command queue must be drained first; the offline queue is retained and
   * replayed by the caller once writes resume. Future reconnects target the
   * adopted endpoint through the adopted connector.
   */
  private adoptTransport(
    transport: DetachedTransport,
    endpoint: HandoffEndpoint
  ): void {
    if (this.status !== "ready") {
      throw new Error(
        `Cannot adopt a transport while the connection is "${this.status}"`
      );
    }
    if (this.commandQueue.length > 0) {
      throw new Error(
        "Cannot adopt a transport while commands are awaiting replies"
      );
    }

    debug(
      "adopt transport %s:%s (epoch %d)",
      endpoint.host,
      endpoint.port,
      this.connectionEpoch + 1
    );

    // Silence and dispose the drained old transport. With its listeners
    // removed, destroying it cannot trigger the reconnect path.
    const oldStream = this.stream;
    if (this.socketTimeoutTimer !== undefined) {
      clearTimeout(this.socketTimeoutTimer);
      this.socketTimeoutTimer = undefined;
    }
    if (oldStream) {
      oldStream.removeAllListeners("data");
      oldStream.removeAllListeners("error");
      oldStream.removeAllListeners("close");
      oldStream.destroy();
    }

    // The watch set lives on the connection being replaced; executing a
    // pending MULTI/EXEC on the adopted one would silently drop the
    // optimistic lock. Remember the loss so the next transaction aborts.
    if (this.condition?.watching) {
      debug("adopting a transport invalidates an active WATCH");
      this.staleWatch = true;
    }

    this.stream = transport.stream;
    this.connector = transport.connector;
    this.condition = transport.condition;
    if ("host" in this.options) {
      this.options.host = endpoint.host;
      this.options.port = endpoint.port;
    }

    // Invalidate stale asynchronous callbacks bound to the old connection.
    this.connectionEpoch += 1;

    // HIMPORT PREPARE state is scoped to the server-side session, and the
    // adopted connection has never seen one (the candidate is created
    // without fieldsets). Start a fresh coordinator session — exactly what
    // a reconnect does — so managed commands re-prepare their fieldsets on
    // the new connection before use.
    getHimportBinding(this)?.coordinator.beginSession(this);

    new DataHandler(this, {
      stringNumbers: this.options.stringNumbers ?? false,
      replyMapping: this.condition.replyMapping,
      onMaintenanceNotification: this.maintenanceManager?.handle,
    });
    transport.stream.once("error", eventHandler.errorHandler(this));
    transport.stream.once("close", eventHandler.closeHandler(this));
  }

  /**
   * Resolves when every command written to the current connection has
   * received its reply, or rejects when the connection closes first.
   */
  private waitForCommandQueueToDrain(): Promise<void> {
    if (this.commandQueue.length === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const onDrained = () => {
        cleanup();
        resolve();
      };
      const onClose = () => {
        cleanup();
        reject(
          new Error("Connection closed while waiting for the command queue")
        );
      };
      const cleanup = () => {
        this.removeListener(COMMAND_QUEUE_DRAINED, onDrained);
        this.removeListener("close", onClose);
      };
      this.once(COMMAND_QUEUE_DRAINED, onDrained);
      this.once("close", onClose);
    });
  }

  scanStream(options?: ScanStreamOptions) {
    return this.createScanStream("scan", { options });
  }

  scanBufferStream(options?: ScanStreamOptions) {
    return this.createScanStream("scanBuffer", { options });
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
   * Emit only when there's at least one listener.
   *
   * @ignore
   */
  silentEmit(eventName: string, arg?: unknown): boolean {
    let error: unknown;
    if (eventName === "error") {
      error = arg;

      if (this.status === "end") {
        return;
      }

      if (this.manuallyClosing) {
        // ignore connection related errors when manually disconnecting
        if (
          error instanceof Error &&
          (error.message === CONNECTION_CLOSED_ERROR_MSG ||
            // @ts-expect-error
            error.syscall === "connect" ||
            // @ts-expect-error
            error.syscall === "read")
        ) {
          return;
        }
      }
    }
    if (this.listeners(eventName).length > 0) {
      return this.emit.apply(this, arguments);
    }
    if (error && error instanceof Error) {
      console.error("[ioredis] Unhandled error event:", error.stack);
    }
    return false;
  }

  /**
   * @ignore
   */
  recoverFromFatalError(
    _commandError: Error,
    err: Error,
    options: FlushQueueOptions
  ) {
    this.flushQueue(err, options);
    this.silentEmit("error", err);
    this.disconnect(true);
  }

  /**
   * @ignore
   */
  handleReconnection(err: Error, item: CommandItem) {
    let needReconnect: ReturnType<ReconnectOnError> = false;
    const ignoreReconnectOnError =
      Command.checkFlag("IGNORE_RECONNECT_ON_ERROR", item.command.name) ||
      (this.condition?.handshake &&
        Command.checkFlag("HANDSHAKE_COMMANDS", item.command.name));

    if (this.options.reconnectOnError && !ignoreReconnectOnError) {
      needReconnect = this.options.reconnectOnError(err);
    }

    switch (needReconnect) {
      case 1:
      case true:
        if (this.status !== "reconnecting") {
          this.disconnect(true);
        }
        item.command.reject(err);
        break;
      case 2:
        if (this.status !== "reconnecting") {
          this.disconnect(true);
        }
        if (
          this.condition?.select !== item.select &&
          item.command.name !== "select"
        ) {
          this.select(item.select);
        }
        // TODO
        // @ts-expect-error
        this.sendCommand(item.command);
        break;
      default:
        item.command.reject(err);
    }
  }

  /**
   * @ignore
   */
  _getServerAddress(): { address: string; port: number | undefined } {
    if ("path" in this.options && this.options.path) {
      return { address: this.options.path, port: undefined };
    }
    return {
      address: ("host" in this.options && this.options.host) || "localhost",
      port: ("port" in this.options && this.options.port) || 6379,
    };
  }

  private _buildCommandContext(command: Command): CommandTraceContext {
    const { address, port } = this._getServerAddress();
    return {
      command: command.name,
      args: sanitizeArgs(command.name, command.args),
      database: this.condition?.select ?? this.options.db ?? 0,
      serverAddress: address,
      serverPort: port,
    };
  }

  _buildBatchContext(batchSize: number): BatchOperationContext {
    const { address, port } = this._getServerAddress();
    return {
      batchMode: "MULTI",
      batchSize,
      database: this.condition?.select ?? this.options.db ?? 0,
      serverAddress: address,
      serverPort: port,
    };
  }

  /**
   * Get description of the connection. Used for debugging.
   */
  private _getDescription() {
    let description;
    if ("path" in this.options && this.options.path) {
      description = this.options.path;
    } else if (
      this.stream &&
      this.stream.remoteAddress &&
      this.stream.remotePort
    ) {
      description = this.stream.remoteAddress + ":" + this.stream.remotePort;
    } else if ("host" in this.options && this.options.host) {
      description = this.options.host + ":" + this.options.port;
    } else {
      // Unexpected
      description = "";
    }
    if (this.options.connectionName) {
      description += ` (${this.options.connectionName})`;
    }
    return description;
  }

  private resetCommandQueue() {
    this.commandQueue = new Deque();
  }

  private resetOfflineQueue() {
    this.offlineQueue = new Deque();
  }

  private parseOptions(...args: unknown[]) {
    const options: Record<string, unknown> = {};
    let isTls = false;
    for (let i = 0; i < args.length; ++i) {
      const arg = args[i];
      if (arg === null || typeof arg === "undefined") {
        continue;
      }
      if (typeof arg === "object") {
        defaults(options, arg);
      } else if (typeof arg === "string") {
        defaults(options, parseURL(arg));
        if (arg.startsWith("rediss://")) {
          isTls = true;
        }
      } else if (typeof arg === "number") {
        options.port = arg;
      } else {
        throw new Error("Invalid argument " + arg);
      }
    }
    if (isTls) {
      defaults(options, { tls: true });
    }
    defaults(options, Redis.defaultOptions);

    if (typeof options.port === "string") {
      options.port = parseInt(options.port, 10);
    }
    if (typeof options.db === "string") {
      options.db = parseInt(options.db, 10);
    }

    if (options.replyMapping === "resp3" && options.protocol !== 3) {
      throw new Error(
        'The "resp3" replyMapping is only supported with protocol 3'
      );
    }

    // @ts-expect-error
    this.options = resolveTLSProfile(options);
  }

  /**
   * Change instance's status
   */
  private setStatus(status: RedisStatus, arg?: unknown) {
    // @ts-expect-error
    if (debug.enabled) {
      debug(
        "status[%s]: %s -> %s",
        this._getDescription(),
        this.status || "[empty]",
        status
      );
    }
    this.status = status;
    process.nextTick(this.emit.bind(this, status, arg));
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

  /**
   * Flush offline queue and command queue with error.
   *
   * @param error The error object to send to the commands
   * @param options options
   */
  private flushQueue(error: Error, options?: FlushQueueOptions) {
    options = defaults({}, options, {
      offlineQueue: true,
      commandQueue: true,
    });

    let item;
    if (options.offlineQueue) {
      while ((item = this.offlineQueue.shift())) {
        item.command.reject(error);
      }
    }

    if (options.commandQueue) {
      if (this.commandQueue.length > 0) {
        if (this.stream) {
          this.stream.removeAllListeners("data");
        }

        while ((item = this.commandQueue.shift())) {
          item.command.reject(error);
        }
      }
    }
  }

  /**
   * Check whether Redis has finished loading the persistent data and is able to
   * process commands.
   */
  private _readyCheck(callback: Callback) {
    const _this = this;
    this.info(function (err, res) {
      if (err) {
        if (err.message && err.message.includes("NOPERM")) {
          console.warn(
            `Skipping the ready check because INFO command fails: "${err.message}". You can disable ready check with "enableReadyCheck". More: https://github.com/luin/ioredis/wiki/Disable-ready-check.`
          );
          return callback(null, {});
        }
        return callback(err);
      }
      if (typeof res !== "string") {
        return callback(null, res);
      }

      const info: { [key: string]: any } = {};

      const lines = res.split("\r\n");
      for (let i = 0; i < lines.length; ++i) {
        const [fieldName, ...fieldValueParts] = lines[i].split(":");
        const fieldValue = fieldValueParts.join(":");
        if (fieldValue) {
          info[fieldName] = fieldValue;
        }
      }

      if (!info.loading || info.loading === "0") {
        callback(null, info);
      } else {
        const loadingEtaMs = (info.loading_eta_seconds || 1) * 1000;
        const retryTime =
          _this.options.maxLoadingRetryTime &&
          _this.options.maxLoadingRetryTime < loadingEtaMs
            ? _this.options.maxLoadingRetryTime
            : loadingEtaMs;
        debug(
          "Redis server still loading, trying again in " + retryTime + "ms"
        );
        setTimeout(function () {
          _this._readyCheck(callback);
        }, retryTime);
      }
    }).catch(noop);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Redis<ReplyMapping extends "legacy" | "resp3" = "legacy">
  extends EventEmitter {
  on(event: "message", cb: (channel: string, message: string) => void): this;
  once(event: "message", cb: (channel: string, message: string) => void): this;

  on(
    event: "messageBuffer",
    cb: (channel: Buffer, message: Buffer) => void
  ): this;
  once(
    event: "messageBuffer",
    cb: (channel: Buffer, message: Buffer) => void
  ): this;

  on(
    event: "pmessage",
    cb: (pattern: string, channel: string, message: string) => void
  ): this;
  once(
    event: "pmessage",
    cb: (pattern: string, channel: string, message: string) => void
  ): this;

  on(
    event: "pmessageBuffer",
    cb: (pattern: string, channel: Buffer, message: Buffer) => void
  ): this;
  once(
    event: "pmessageBuffer",
    cb: (pattern: string, channel: Buffer, message: Buffer) => void
  ): this;

  on(event: "error", cb: (error: Error) => void): this;
  once(event: "error", cb: (error: Error) => void): this;

  on(event: RedisStatus, cb: () => void): this;
  once(event: RedisStatus, cb: () => void): this;

  // base method of EventEmitter
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
}

applyMixin(Redis, EventEmitter);

addTransactionSupport(Redis.prototype);
interface Redis<ReplyMapping extends "legacy" | "resp3" = "legacy">
  extends Transaction<ReplyMapping extends "resp3" ? "resp3" : "resp2"> {}

export default Redis;
