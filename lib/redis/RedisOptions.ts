import { CommanderOptions } from "../utils/Commander";
import ConnectorConstructor from "../connectors/ConnectorConstructor";
import { SentinelConnectionOptions } from "../connectors/SentinelConnector";
import { StandaloneConnectionOptions } from "../connectors/StandaloneConnector";
import { ProtocolVersion, ReplyMappingMode } from "../types";
import type { HimportFieldset } from "../himport/types";
import type {
  MaintEndpointType,
  MaintNotifications,
} from "../maintNotifications";

export type ReconnectOnError = (err: Error) => boolean | 1 | 2;
export type RetryStrategy =
  | ((times: number) => number | void | null)
  | null
  | undefined;

export interface CommonRedisOptions extends CommanderOptions {
  Connector?: ConnectorConstructor | undefined;

  /**
   * Determines the delay in milliseconds before reconnecting after a connection loss.
   *
   * @default Exponential backoff capped at 5000ms, plus 0-199ms of random jitter.
   */
  retryStrategy?: RetryStrategy;

  /**
   * If a command does not return a reply within a set number of milliseconds,
   * a "Command timed out" error will be thrown.
   */
  commandTimeout?: number | undefined;

  /**
   * Enables client-side timeout protection for blocking commands when set
   * to a positive number. If `blockingTimeout` is undefined, `0`, or
   * negative (e.g. `-1`), the protection is disabled and no client-side
   * timers are installed for blocking commands.
   */
  blockingTimeout?: number | undefined;

  /**
   * Grace period (ms) added to blocking command timeouts. Only used when
   * `blockingTimeout` is a positive number. Defaults to 100ms.
   */
  blockingTimeoutGrace?: number | undefined;

  /**
   * If the socket does not receive data within a set number of milliseconds:
   * 1. the socket is considered "dead" and will be destroyed
   * 2. the client will reject any running commands (altought they might have been processed by the server)
   * 3. the reconnect strategy will kick in (depending on the configuration)
   */
  socketTimeout?: number | undefined;

  /**
   * Initial delay in milliseconds before the first TCP keep-alive probe.
   * @link https://nodejs.org/api/net.html#socketsetkeepaliveenable-initialdelay
   * @default 30000
   */
  keepAlive?: number | undefined;

  /**
   * Enable/disable the use of Nagle's algorithm.
   * @link https://nodejs.org/api/net.html#socketsetnodelaynodelay
   * @default true
   */
  noDelay?: boolean | undefined;

  /**
   * Set the name of the connection to make it easier to identity the connection
   * in client list.
   * @link https://redis.io/commands/client-setname
   */
  connectionName?: string | undefined;

  /**
   * If true, skips setting library info via CLIENT SETINFO.
   * @link https://redis.io/docs/latest/commands/client-setinfo/
   * @default false
   */
  disableClientInfo?: boolean | undefined;

  /**
   * Tag to append to the library name in CLIENT SETINFO (ioredis(tag)).
   * @link https://redis.io/docs/latest/commands/client-setinfo/
   * @default undefined
   */
  clientInfoTag?: string | undefined;

  /**
   * If set, client will send AUTH command with the value of this option as the first argument when connected.
   * This is supported since Redis 6.
   */
  username?: string | undefined;

  /**
   * If set, client will send AUTH command with the value of this option when connected.
   */
  password?: string | undefined;

  /**
   * Database index to use.
   *
   * @default 0
   */
  db?: number | undefined;

  /**
   * When the client reconnects, channels subscribed in the previous connection will be
   * resubscribed automatically if `autoResubscribe` is `true`.
   * @default true
   */
  autoResubscribe?: boolean | undefined;

  /**
   * Whether or not to resend unfulfilled commands on reconnect.
   * Unfulfilled commands are most likely to be blocking commands such as `brpop` or `blpop`.
   * @default true
   */
  autoResendUnfulfilledCommands?: boolean | undefined;
  /**
   * Whether or not to reconnect on certain Redis errors.
   * This options by default is `null`, which means it should never reconnect on Redis errors.
   * You can pass a function that accepts an Redis error, and returns:
   * - `true` or `1` to trigger a reconnection.
   * - `false` or `0` to not reconnect.
   * - `2` to reconnect and resend the failed command (who triggered the error) after reconnection.
   * @example
   * ```js
   * const redis = new Redis({
   *   reconnectOnError(err) {
   *     const targetError = "READONLY";
   *     if (err.message.includes(targetError)) {
   *       // Only reconnect when the error contains "READONLY"
   *       return true; // or `return 1;`
   *     }
   *   },
   * });
   * ```
   * @default null
   */
  reconnectOnError?: ReconnectOnError | null | undefined;

  /**
   * @default false
   */
  readOnly?: boolean | undefined;
  /**
   * When enabled, numbers returned by Redis will be converted to JavaScript strings instead of numbers.
   * This is necessary if you want to handle big numbers (above `Number.MAX_SAFE_INTEGER` === 2^53).
   * @default false
   */
  stringNumbers?: boolean | undefined;

  /**
   * The RESP protocol version to use.
   * @default 3
   */
  protocol?: ProtocolVersion | undefined;

  /**
   * How RESP3-only reply types are represented in JavaScript.
   * Only supported when `protocol` is 3.
   *
   * - `"legacy"` (default): RESP2-compatible shapes. Map replies arrive as
   *   flat `[key, value, ...]` arrays and doubles as strings, so replies are
   *   identical across both protocols.
   * - `"resp3"`: map replies arrive as plain objects (with string keys) and
   *   doubles as numbers.
   *
   * @default "legacy"
   */
  replyMapping?: ReplyMappingMode | undefined;

  /**
   * Controls registration for Smart Client Handoff maintenance notifications.
   * Smart Client Handoffs require RESP3; this option has no effect with RESP2.
   *
   * - `"auto"`: Try to register and continue if the server does not support it.
   * - `"enabled"`: Register and fail the connection if registration fails.
   * - `"disabled"`: Do not register.
   *
   * @default "auto"
   */
  maintNotifications?: MaintNotifications | undefined;

  /**
   * The endpoint type requested in Smart Client Handoff `MOVING`
   * notifications. `"auto"` classifies the connected peer address as internal
   * or external and requests an FQDN when TLS is enabled. If the connected
   * peer address is unavailable, an IP-literal configured host is used;
   * otherwise the endpoint defaults to external.
   *
   * @default "auto"
   */
  maintEndpointType?: MaintEndpointType | undefined;

  /**
   * Specifies a more relaxed timeout (in milliseconds) for commands during a maintenance window.
   * This helps minimize command timeouts during maintenance. Timeouts during maintenance period result
   * in a `CommandTimeoutDuringMaintenance` error.
   *
   * @default 10000
   */
  maintRelaxedCommandTimeout?: number;

  /**
   * Specifies a more relaxed timeout (in milliseconds) for the socket during a maintenance window.
   * This helps minimize socket timeouts during maintenance. Timeouts during maintenance period result
   * in a `SocketTimeoutDuringMaintenance` error.
   *
   * @default 10000
   */
  maintRelaxedSocketTimeout?: number;

  /**
   * How long the client will wait before killing a socket due to inactivity during initial connection.
   * @default 10000
   */
  connectTimeout?: number | undefined;

  /**
   * This option is used internally when you call `redis.monitor()` to tell Redis
   * to enter the monitor mode when the connection is established.
   *
   * @default false
   */
  monitor?: boolean | undefined;

  /**
   * The commands that don't get a reply due to the connection to the server is lost are
   * put into a queue and will be resent on reconnect (if allowed by the `retryStrategy` option).
   * This option is used to configure how many reconnection attempts should be allowed before
   * the queue is flushed with a `MaxRetriesPerRequestError` error.
   * Set this options to `null` instead of a number to let commands wait forever
   * until the connection is alive again.
   *
   * @default 20
   */
  maxRetriesPerRequest?: number | null | undefined;

  /**
   * @default 10000
   */
  maxLoadingRetryTime?: number | undefined;
  /**
   * @default false
   */
  enableAutoPipelining?: boolean | undefined;
  /**
   * @default []
   */
  autoPipeliningIgnoredCommands?: string[] | undefined;
  offlineQueue?: boolean | undefined;
  commandQueue?: boolean | undefined;

  /**
   *
   * By default, if the connection to Redis server has not been established, commands are added to a queue
   * and are executed once the connection is "ready" (when `enableReadyCheck` is true, "ready" means
   * the Redis server has loaded the database from disk, otherwise means the connection to the Redis
   * server has been established). If this option is false, when execute the command when the connection
   * isn't ready, an error will be returned.
   *
   * @default true
   */
  enableOfflineQueue?: boolean | undefined;

  /**
   * The client will sent an INFO command to check whether the server is still loading data from the disk (
   * which happens when the server is just launched) when the connection is established, and only wait until
   * the loading process is finished before emitting the `ready` event.
   *
   * @default true
   */
  enableReadyCheck?: boolean | undefined;

  /**
   * When a Redis instance is initialized, a connection to the server is immediately established. Set this to
   * true will delay the connection to the server until the first command is sent or `redis.connect()` is called
   * explicitly. When `redis.connect()` is called explicitly, a Promise is returned, which will be resolved
   * when the connection is ready or rejected when it fails. The rejection should be handled by the user.
   *
   * @default false
   */

  lazyConnect?: boolean | undefined;

  /**
   * @default undefined
   */
  scripts?:
    | Record<
        string,
        {
          lua: string;
          numberOfKeys?: number | undefined;
          readOnly?: boolean | undefined;
        }
      >
    | undefined;

  /**
   * Managed-fieldset support is experimental and requires Redis 8.10 or newer.
   *
   * Long-lived HIMPORT fieldsets managed for the lifetime of this client.
   * Definitions are copied during construction and prepared again whenever
   * the physical Redis connection changes.
   *
   * When a managed `HIMPORT SET` needs fieldset preparation or recovery,
   * later commands issued on this client may be sent before that SET resumes.
   * Await the SET before issuing commands that depend on its write.
   *
   * Explicit pipelines containing a managed `HIMPORT SET` wait for required
   * fieldset preparation before the batch is sent.
   *
   * Background preparation failures do not prevent the connection from
   * becoming ready and are reported through the `error` event. A dependent
   * managed `HIMPORT SET` retries preparation and rejects if recovery fails.
   *
   * Use explicit `HIMPORT PREPARE` and `DISCARD` commands on a separate
   * client for bounded, manually managed batches.
   *
   * @default undefined
   * @experimental
   */
  himportFieldsets?: readonly HimportFieldset[] | undefined;
}

export type RedisOptions = CommonRedisOptions &
  SentinelConnectionOptions &
  StandaloneConnectionOptions;

export const DEFAULT_REDIS_OPTIONS: RedisOptions = {
  // Connection
  port: 6379,
  host: "localhost",
  family: 0,
  connectTimeout: 10000,
  disconnectTimeout: 2000,
  retryStrategy: function (times) {
    const jitter = Math.floor(Math.random() * 200);
    // `times` is one-based, so the first retry uses an exponent of zero.
    const delay = Math.min(Math.pow(2, times - 1) * 50, 5000);
    return delay + jitter;
  },
  keepAlive: 30000,
  noDelay: true,
  connectionName: null,
  disableClientInfo: false,
  clientInfoTag: undefined,
  // Sentinel
  sentinels: null,
  name: null,
  role: "master",
  sentinelRetryStrategy: function (times) {
    return Math.min(times * 10, 1000);
  },
  sentinelReconnectStrategy: function () {
    // This strategy only applies when sentinels are used for detecting
    // a failover, not during initial master resolution.
    // The deployment can still function when some of the sentinels are down
    // for a long period of time, so we may not want to attempt reconnection
    // very often. Therefore the default interval is fairly long (1 minute).
    return 60000;
  },
  natMap: null,
  enableTLSForSentinelMode: false,
  updateSentinels: true,
  failoverDetector: false,
  // Status
  username: null,
  password: null,
  db: 0,
  // Others
  enableOfflineQueue: true,
  enableReadyCheck: true,
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,
  lazyConnect: false,
  keyPrefix: "",
  reconnectOnError: null,
  readOnly: false,
  stringNumbers: false,
  protocol: 3,
  replyMapping: "legacy",
  maintNotifications: "auto",
  maintEndpointType: "auto",
  maintRelaxedCommandTimeout: 10000,
  maintRelaxedSocketTimeout: 10000,
  maxRetriesPerRequest: 20,
  maxLoadingRetryTime: 10000,
  enableAutoPipelining: false,
  autoPipeliningIgnoredCommands: [],
  sentinelMaxConnections: 10,
  blockingTimeoutGrace: 100,
};
