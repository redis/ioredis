import { exists, hasFlag } from "@ioredis/commands";
import { EventEmitter } from "events";
import asCallback from "standard-as-callback";
import Cluster from "./cluster";
import Command from "./Command";
import { DataHandledable, FlushQueueOptions, Condition } from "./DataHandler";
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
  ScanStreamOptions,
  WriteableStream,
} from "./types";
import {
  CONNECTION_CLOSED_ERROR_MSG,
  Debug,
  isInt,
  parseURL,
  resolveTLSProfile,
} from "./utils";
import applyMixin from "./utils/applyMixin";
import Commander from "./utils/Commander";
import { defaults, noop } from "./utils/lodash";
import Deque = require("denque");
const debug = Debug("redis");

type RedisStatus =
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
class Redis extends Commander implements DataHandledable {
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
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private offlineQueue: Deque;
  private connectionEpoch = 0;
  private retryAttempts = 0;
  private manuallyClosing = false;
  private socketTimeoutTimer: NodeJS.Timeout | undefined;

  // Prepare autopipelines structures
  private _autoPipelines = new Map();
  private _runningAutoPipelines = new Set();

  constructor(port: number, host: string, options: RedisOptions);
  constructor(path: string, options: RedisOptions);
  constructor(port: number, options: RedisOptions);
  constructor(port: number, host: string);
  constructor(options: RedisOptions);
  constructor(port: number);
  constructor(path: string);
  constructor();
  constructor(arg1?: unknown, arg2?: unknown, arg3?: unknown) {
    super();
    this.parseOptions(arg1, arg2, arg3);

    EventEmitter.call(this);

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
    const promise = new Promise<void>((resolve, reject) => {
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

      // Note that `this.condition` has to be set _before_ any asynchronous work
      // takes place as the `select` value is required when queueing commands
      // into the offline queue (see sendCommand)
      this.condition = {
        select: options.db,
        subscriber: false,
      };
      this.resolvePassword((err, resolvedPassword) => {
        if (err) {
          this.flushQueue(err);
          this.silentEmit("error", err);
          this.setStatus("end");
          reject(err);
          return;
        }
        this.condition.auth = options.username
          ? [options.username, resolvedPassword]
          : resolvedPassword

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
    });

    return asCallback(promise, callback);
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
  duplicate(override?: Partial<RedisOptions>) {
    return new Redis({ ...this.options, ...override });
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
      : this.condition?.subscriber
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
    if (this.status === "wait") {
      this.connect().catch(noop);
    }
    if (this.status === "end") {
      command.reject(new Error(CONNECTION_CLOSED_ERROR_MSG));
      return command.promise;
    }
    if (
      this.condition?.subscriber &&
      !Command.checkFlag("VALID_IN_SUBSCRIBER_MODE", command.name)
    ) {
      command.reject(
        new Error(
          "Connection in subscriber mode, only subscriber commands may be used"
        )
      );
      return command.promise;
    }

    if (typeof this.options.commandTimeout === "number") {
      command.setTimeout(this.options.commandTimeout);
    }

    let writable =
      this.status === "ready" ||
      (!stream &&
        this.status === "connect" &&
        exists(command.name, { caseInsensitive: true }) &&
        (hasFlag(command.name, "loading", { nameCaseInsensitive: true }) ||
          Command.checkFlag("HANDSHAKE_COMMANDS", command.name)));
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
            "Stream isn't writeable and enableOfflineQueue options is false"
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

      if (Command.checkFlag("WILL_DISCONNECT", command.name)) {
        this.manuallyClosing = true;
      }

      if (this.options.socketTimeout !== undefined && this.socketTimeoutTimer === undefined) {
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

    return command.promise;
  }

  private setSocketTimeout() {
    this.socketTimeoutTimer = setTimeout(() => {
      this.stream.destroy(new Error(`Socket timeout. Expecting data, but didn't receive any in ${this.options.socketTimeout}ms.`));
      this.socketTimeoutTimer = undefined;
    }, this.options.socketTimeout);

    // this handler must run after the "data" handler in "DataHandler"
    // so that `this.commandQueue.length` will be updated
    this.stream.once("data", () => {
      clearTimeout(this.socketTimeoutTimer);
      this.socketTimeoutTimer = undefined;
      if (this.commandQueue.length === 0) return;
      this.setSocketTimeout();
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
    if (
      this.options.reconnectOnError &&
      !Command.checkFlag("IGNORE_RECONNECT_ON_ERROR", item.command.name)
    ) {
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

  private resolvePassword(callback: (err: Error | null, password?: string | null) => void) {
    const { password } = this.options;
    if (!password) {
      return callback(null, null);
    }
    if (typeof password === 'function') {
      let p: ReturnType<typeof password> = null;
      try {
        p = password();
      } catch (err) {
        return callback(err);
      }
      if (typeof p === 'string' || !p) {
        return callback(null, p as string);
      }
      return p.then((pw) => callback(null, pw), callback);
    }

    return callback(null, password);
  }
}

interface Redis extends EventEmitter {
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
interface Redis extends Transaction {}

export default Redis;
