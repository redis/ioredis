import { readFileSync } from "fs";

interface RawEndpoint {
  dns_name: string;
  port: number;
}

interface DatabaseConfig {
  username?: string;
  password?: string;
  tls: boolean;
  raw_endpoints?: RawEndpoint[];
  endpoints?: string[];
}

type DatabasesConfig = Record<string, DatabaseConfig>;

export interface REConnection {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls: boolean;
}

export function isReCluster(): boolean {
  return (process.env.RE_CLUSTER || "").toLowerCase() === "true";
}

/**
 * Resolves the managed Redis Enterprise database the functional suite should target.
 *
 * Reads the database named by RE_DB_NAME (default "standalone") from the endpoints
 * config at REDIS_ENDPOINTS_CONFIG_PATH - the same format consumed by the scenario
 * tests - and returns its host, port, credentials and TLS flag.
 */
export function loadREConnection(): REConnection {
  const path = process.env.REDIS_ENDPOINTS_CONFIG_PATH;
  if (!path) {
    throw new Error(
      "REDIS_ENDPOINTS_CONFIG_PATH must be set when RE_CLUSTER=true"
    );
  }

  const data = JSON.parse(readFileSync(path, "utf8")) as DatabasesConfig;
  const name = process.env.RE_DB_NAME || "standalone";
  const db = data[name] ?? Object.values(data)[0];
  if (!db) {
    throw new Error(`Database ${name} not found in ${path}`);
  }

  const endpoint = db.raw_endpoints?.[0];
  let host: string;
  let port: number;
  if (endpoint) {
    host = endpoint.dns_name;
    port = endpoint.port;
  } else if (db.endpoints?.[0]) {
    const parsed = new URL(db.endpoints[0]);
    host = parsed.hostname;
    port = parsed.port
      ? parseInt(parsed.port, 10)
      : parsed.protocol === "rediss:"
        ? 6380
        : 6379;
  } else {
    throw new Error(`No endpoints found for database ${name} in ${path}`);
  }

  return {
    host,
    port,
    username: db.username || undefined,
    password: db.password || undefined,
    tls: db.tls,
  };
}
