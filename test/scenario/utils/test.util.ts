import { readFileSync } from "fs";
import { Cluster, ClusterOptions } from "../../../lib";

interface DatabaseEndpoint {
  addr: string[];
  addr_type: string;
  dns_name: string;
  oss_cluster_api_preferred_endpoint_type: string;
  oss_cluster_api_preferred_ip_type: string;
  port: number;
  proxy_policy: string;
  uid: string;
}

interface DatabaseConfig {
  bdb_id: number;
  username: string;
  password: string;
  tls: boolean;
  raw_endpoints: DatabaseEndpoint[];
  endpoints: string[];
}

type DatabasesConfig = Record<string, DatabaseConfig>;

interface EnvConfig {
  redisEndpointsConfigPath: string;
  faultInjectorUrl: string;
}

export interface RedisConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
  bdbId: number;
}

export interface DatabaseModule {
  module_name: string;
  [key: string]: unknown;
}

export interface ShardKeyRegexPattern {
  regex: string;
  [key: string]: unknown;
}

export interface CreateDatabaseConfig {
  name: string;
  port: number;
  memory_size: number;
  replication: boolean;
  eviction_policy: string;
  sharding: boolean;
  auto_upgrade: boolean;
  shards_count: number;
  module_list?: DatabaseModule[];
  oss_cluster: boolean;
  oss_cluster_api_preferred_ip_type?: string;
  proxy_policy?: string;
  shards_placement?: string;
  shard_key_regex?: ShardKeyRegexPattern[];
}

export interface TestConfig {
  clientConfig: RedisConnectionConfig;
  faultInjectorUrl: string;
}

export const CreateDatabaseConfigType = {
  CLUSTER: "cluster",
  STANDALONE: "standalone",
} as const;

type ConfigType =
  (typeof CreateDatabaseConfigType)[keyof typeof CreateDatabaseConfigType];

// 10000-19999
const randomPort = () => Math.floor(Math.random() * (19999 - 10000) + 10000);

const getTestDatabaseName = (namePrefix: string) => {
  return `${namePrefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
};

const DB_CONFIGS: Record<
  ConfigType,
  (namePrefix: string, port?: number, size?: number) => CreateDatabaseConfig
> = {
  [CreateDatabaseConfigType.CLUSTER]: (
    namePrefix: string,
    port: number = randomPort(),
    size = 1073741824 // 1GB
  ) => {
    return {
      name: getTestDatabaseName(namePrefix),
      port,
      memory_size: size,
      replication: true,
      eviction_policy: "noeviction",
      sharding: true,
      auto_upgrade: true,
      shards_count: 3,
      module_list: [
        {
          module_args: "",
          module_name: "ReJSON",
        },
        {
          module_args: "",
          module_name: "search",
        },
        {
          module_args: "",
          module_name: "timeseries",
        },
        {
          module_args: "",
          module_name: "bf",
        },
      ],
      oss_cluster: true,
      oss_cluster_api_preferred_ip_type: "external",
      proxy_policy: "all-master-shards",
      shards_placement: "sparse",
      shard_key_regex: [
        {
          regex: ".*\\{(?<tag>.*)\\}.*",
        },
        {
          regex: "(?<tag>.*)",
        },
      ],
    };
  },
  [CreateDatabaseConfigType.STANDALONE]: (
    namePrefix: string,
    port: number = randomPort(),
    size = 1073741824 // 1GB
  ) => {
    return {
      name: getTestDatabaseName(namePrefix),
      port,
      memory_size: size,
      replication: true,
      eviction_policy: "noeviction",
      sharding: true,
      auto_upgrade: true,
      shards_count: 2,
      oss_cluster: false,
      proxy_policy: "single",
      shards_placement: "dense",
      shard_key_regex: [
        {
          regex: ".*\\{(?<tag>.*)\\}.*",
        },
        {
          regex: "(?<tag>.*)",
        },
      ],
    };
  },
};

export const getCreateDatabaseConfig = (
  type: ConfigType,
  namePrefix = `ioredis-${type}`
) => {
  return DB_CONFIGS[type](namePrefix);
};

/**
 * Reads environment variables required for the test scenario
 * @returns Environment configuration object
 * @throws Error if required environment variables are not set
 */
const getEnvConfig = (): EnvConfig => {
  if (!process.env["REDIS_ENDPOINTS_CONFIG_PATH"]) {
    throw new Error(
      "REDIS_ENDPOINTS_CONFIG_PATH environment variable must be set"
    );
  }

  if (!process.env["RE_FAULT_INJECTOR_URL"]) {
    throw new Error("RE_FAULT_INJECTOR_URL environment variable must be set");
  }

  return {
    redisEndpointsConfigPath: process.env["REDIS_ENDPOINTS_CONFIG_PATH"],
    faultInjectorUrl: process.env["RE_FAULT_INJECTOR_URL"],
  };
};

/**
 * Reads database configuration from a file
 * @param filePath - The path to the database configuration file
 * @returns Parsed database configuration object
 * @throws Error if file doesn't exist or JSON is invalid
 */
const getDatabaseConfigFromEnv = (filePath: string): DatabasesConfig => {
  try {
    const fileContent = readFileSync(filePath, "utf8");
    return JSON.parse(fileContent) as DatabasesConfig;
  } catch (_error) {
    throw new Error(`Failed to read or parse database config from ${filePath}`);
  }
};

/**
 * Gets Redis connection parameters for a specific database
 * @param databasesConfig - The parsed database configuration object
 * @param databaseName - Optional name of the database to retrieve (defaults to the first one)
 * @returns Redis connection configuration with host, port, username, password, and tls
 * @throws Error if the specified database is not found in the configuration
 */
const getDatabaseConfig = (
  databasesConfig: DatabasesConfig,
  databaseName?: string
): RedisConnectionConfig => {
  const dbConfig = databaseName
    ? databasesConfig[databaseName]
    : Object.values(databasesConfig)[0];

  if (!dbConfig) {
    throw new Error(
      `Database ${databaseName || ""} not found in configuration`
    );
  }

  const endpoint = dbConfig.raw_endpoints[0]; // Use the first endpoint

  if (!endpoint) {
    throw new Error(`No endpoints found for database ${databaseName}`);
  }

  return {
    host: endpoint.dns_name,
    port: endpoint.port,
    username: dbConfig.username,
    password: dbConfig.password,
    tls: dbConfig.tls,
    bdbId: dbConfig.bdb_id,
  };
};

/**
 * Gets Redis connection parameters for a specific database
 * @returns Redis client config and fault injector URL
 * @throws Error if required environment variables are not set or if database config is invalid
 */
export const getConfig = (): TestConfig => {
  const envConfig = getEnvConfig();
  const redisConfig = getDatabaseConfigFromEnv(
    envConfig.redisEndpointsConfigPath
  );

  return {
    clientConfig: getDatabaseConfig(redisConfig),
    faultInjectorUrl: envConfig.faultInjectorUrl,
  };
};

/**
 * Creates a test cluster client with the provided configuration, connects it and attaches an error handler listener
 * @param clientConfig - The Redis connection configuration
 * @param options - Optional cluster options
 * @returns The created Redis Cluster client
 */
export const createClusterTestClient = (
  clientConfig: RedisConnectionConfig,
  options: Partial<ClusterOptions> = {}
) => {
  const { redisOptions, ...clusterOptions } = options;

  return new Cluster(
    [
      {
        host: clientConfig.host,
        port: clientConfig.port,
      },
    ],
    {
      ...clusterOptions,
      redisOptions: {
        ...redisOptions,
        ...(clientConfig.password && { password: clientConfig.password }),
        ...(clientConfig.username && { username: clientConfig.username }),
      },
    }
  );
};

/**
 * Waits for a Redis or Cluster client to reach the `"ready"` state.
 *
 * @param client - An `ioredis` `Redis` or `Cluster` instance.
 * @param timeoutMs - Timeout in ms (default: 5000).
 * @returns Promise that resolves when the client is ready.
 * @throws {Error} If the client errors or does not become ready before the timeout.
 */
export const waitClientReady = async (client: Cluster, timeoutMs = 5_000) => {
  if (client["status"] === "ready") {
    return;
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off("ready", onReady);
      client.off("error", onError);
      reject(
        new Error(
          `Client ready timeout after ${timeoutMs}ms. Current status: ${client["status"]}`
        )
      );
    }, timeoutMs);

    const onReady = () => {
      clearTimeout(timeout);
      client.off("error", onError);
      client
        .ping()
        .then(() => resolve())
        .catch(reject);
    };

    const onError = (error: Error) => {
      clearTimeout(timeout);
      client.off("ready", onReady);
      reject(error);
    };

    client.once("ready", onReady);
    client.once("error", onError);
  });
};

export const wait = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const waitForAssertion = async (
  assertion: () =>  void | Promise<void>,
  timeoutMs = 5_000,
  intervalMs = 100
) => {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      await assertion();
      return;
    } catch {
      await wait(intervalMs);
    }
  }

  await assertion();
};

/**
 * A list of example Redis Cluster channel keys covering all slot ranges.
 */
export const CHANNELS = [
  "channel:11kv:1000",
  "channel:osy:2000",
  "channel:jn6:3000",
  "channel:l00:4000",
  "channel:4ez:5000",
  "channel:4ek:6000",
  "channel:9vn:7000",
  "channel:dw1:8000",
  "channel:9zi:9000",
  "channel:4vl:10000",
  "channel:utl:11000",
  "channel:lyo:12000",
  "channel:jzn:13000",
  "channel:14uc:14000",
  "channel:mz:15000",
  "channel:d0v:16000",
];

export const CHANNELS_BY_SLOT = {
  1000: "channel:11kv:1000",
  2000: "channel:osy:2000",
  3000: "channel:jn6:3000",
  4000: "channel:l00:4000",
  5000: "channel:4ez:5000",
  6000: "channel:4ek:6000",
  7000: "channel:9vn:7000",
  8000: "channel:dw1:8000",
  9000: "channel:9zi:9000",
  10000: "channel:4vl:10000",
  11000: "channel:utl:11000",
  12000: "channel:lyo:12000",
  13000: "channel:jzn:13000",
  14000: "channel:14uc:14000",
  15000: "channel:mz:15000",
  16000: "channel:d0v:16000",
} as const;
