import { CommanderOptions } from "../utils/Commander";
import ConnectorConstructor from "../connectors/ConnectorConstructor";
import { SentinelConnectionOptions } from "../connectors/SentinelConnector";
import { StandaloneConnectionOptions } from "../connectors/StandaloneConnector";

export type ReconnectOnError = (err: Error) => boolean | 1 | 2;

export interface CommonRedisOptions extends CommanderOptions {
  Connector?: ConnectorConstructor;
  retryStrategy?: (times: number) => number | void | null;
  commandTimeout?: number;
  /**
   * Enable/disable keep-alive functionality.
   * @link https://nodejs.org/api/net.html#socketsetkeepaliveenable-initialdelay
   * @default 0
   */
  keepAlive?: number;
  /**
   * Enable/disable the use of Nagle's algorithm.
   * @link https://nodejs.org/api/net.html#socketsetnodelaynodelay
   * @default true
   */
  noDelay?: boolean;
  /**
   * Set the name of the connection to make it easier to identity the connection
   * in client list.
   * @link https://redis.io/commands/client-setname
   */
  connectionName?: string;
  username?: string;
  password?: string;
  /**
   * @default 0
   */
  db?: number;
  /**
   * @default true
   */
  autoResubscribe?: boolean;
  /**
   * Whether or not to resend unfulfilled commands on reconnect.
   * Unfulfilled commands are most likely to be blocking commands such as `brpop` or `blpop`.
   * @default true
   */
  autoResendUnfulfilledCommands?: boolean;
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
  reconnectOnError?: ReconnectOnError | null;
  /**
   * @default false
   */
  readOnly?: boolean;
  /**
   * When enabled, numbers returned by Redis will be converted to JavaScript strings instead of numbers.
   * This is necessary if you want to handle big numbers (above `Number.MAX_SAFE_INTEGER` === 2^53).
   * @default false
   */
  stringNumbers?: boolean;
  /**
   * @default 10000
   */
  connectTimeout?: number;
  /**
   * @default false
   */
  monitor?: boolean;
  /**
   * @default 20
   */
  maxRetriesPerRequest?: number | null;
  /**
   * @default 10000
   */
  maxLoadingRetryTime?: number;
  /**
   * @default false
   */
  enableAutoPipelining?: boolean;
  /**
   * @default []
   */
  autoPipeliningIgnoredCommands?: string[];
  offlineQueue?: boolean;
  commandQueue?: boolean;
  /**
   * @default true
   */
  enableOfflineQueue?: boolean;
  /**
   * @default true
   */
  enableReadyCheck?: boolean;
  /**
   * @default false
   */
  lazyConnect?: boolean;
  /**
   * @default undefined
   */
  scripts?: Record<
    string,
    { lua: string; numberOfKeys?: number; readOnly?: boolean }
  >;
}

export type RedisOptions = CommonRedisOptions &
  SentinelConnectionOptions &
  StandaloneConnectionOptions;

export const DEFAULT_REDIS_OPTIONS: RedisOptions = {
  // Connection
  port: 6379,
  host: "localhost",
  family: 4,
  connectTimeout: 10000,
  disconnectTimeout: 2000,
  retryStrategy: function (times) {
    return Math.min(times * 50, 2000);
  },
  keepAlive: 0,
  noDelay: true,
  connectionName: null,
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
  maxRetriesPerRequest: 20,
  maxLoadingRetryTime: 10000,
  enableAutoPipelining: false,
  autoPipeliningIgnoredCommands: [],
  sentinelMaxConnections: 10,
};
