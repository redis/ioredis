import { CommanderOptions } from "../utils/Commander";
import ConnectorConstructor from "../connectors/ConnectorConstructor";
import { SentinelConnectionOptions } from "../connectors/SentinelConnector";
import { StandaloneConnectionOptions } from "../connectors/StandaloneConnector";

export type ReconnectOnError = (err: Error) => boolean | 1 | 2;

interface CommonRedisOptions extends CommanderOptions {
  Connector?: ConnectorConstructor;
  retryStrategy?: (times: number) => number | void | null;
  commandTimeout?: number;
  keepAlive?: number;
  noDelay?: boolean;
  connectionName?: string;
  username?: string;
  password?: string;
  db?: number;
  autoResubscribe?: boolean;
  autoResendUnfulfilledCommands?: boolean;
  reconnectOnError?: ReconnectOnError;
  readOnly?: boolean;
  stringNumbers?: boolean;
  connectTimeout?: number;
  monitor?: boolean;
  maxRetriesPerRequest?: number;
  maxLoadingRetryTime?: number;
  enableAutoPipelining?: boolean;
  autoPipeliningIgnoredCommands?: string[];
  maxScriptsCachingTime?: number;
  offlineQueue?: boolean;
  commandQueue?: boolean;
  enableOfflineQueue?: boolean;
  enableReadyCheck?: boolean;
  lazyConnect?: boolean;
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
  maxScriptsCachingTime: 60000,
  sentinelMaxConnections: 10,
};
