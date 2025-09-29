import { readFileSync } from "fs";
import { Cluster } from "../../../lib";
import { IClusterOptions } from "../../../lib/cluster/ClusterOptions";

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

export interface TestConfig {
  clientConfig: RedisConnectionConfig;
  faultInjectorUrl: string;
}

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

  if (!process.env["FAULT_INJECTION_API_URL"]) {
    throw new Error("FAULT_INJECTION_API_URL environment variable must be set");
  }

  return {
    redisEndpointsConfigPath: process.env["REDIS_ENDPOINTS_CONFIG_PATH"],
    faultInjectorUrl: process.env["FAULT_INJECTION_API_URL"],
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
  options: Partial<IClusterOptions> = {}
) => {
  return new Cluster(
    [
      {
        host: clientConfig.host,
        port: clientConfig.port,
      },
    ],
    {
      redisOptions: {
        ...options.redisOptions,
        ...(clientConfig.password && { password: clientConfig.password }),
        ...(clientConfig.username && { username: clientConfig.username }),
      },
      ...options,
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

/**
 * A list of example Redis Cluster channel keys covering all slot ranges.
 */
export const CHANNELS = [
  // Slots 0–5460
  "channel:bsgw8b:3656",
  "channel:htu38u:3788",
  "channel:tpqsw8:3904",
  "channel:6bu5px:3310",
  "channel:0rjfke:3178",

  // Slots 5461–10922
  "channel:h77pph:6939",
  "channel:vjod55:7071",
  "channel:u2qgrc:6675",
  "channel:3amf95:9693",
  "channel:br6ana:5566",

  // Slots 10923–16383
  "channel:nvivfl:14347",
  "channel:bwgpbd:14479",
  "channel:lv9eqh:14595",
  "channel:pfux80:12975",
  "channel:g1oflk:12843",
];

export const CHANNELS_BY_SLOT = {
  "3656": "channel:bsgw8b:3656",
  "3788": "channel:htu38u:3788",
  "3904": "channel:tpqsw8:3904",
  "3310": "channel:6bu5px:3310",
  "3178": "channel:0rjfke:3178",
  "6939": "channel:h77pph:6939",
  "7071": "channel:vjod55:7071",
  "6675": "channel:u2qgrc:6675",
  "9693": "channel:3amf95:9693",
  "5566": "channel:br6ana:5566",
  "14347": "channel:nvivfl:14347",
  "14479": "channel:bwgpbd:14479",
  "14595": "channel:lv9eqh:14595",
  "12975": "channel:pfux80:12975",
  "12843": "channel:g1oflk:12843",
} as const;
