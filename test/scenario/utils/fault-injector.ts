import { wait } from "./test.util";
import type {
  CreateDatabaseConfig,
  RedisConnectionConfig,
} from "./test.util";
import { CreateDatabaseConfigType, getCreateDatabaseConfig } from "./test.util";

export type ActionType =
  | "dmc_restart"
  | "failover"
  | "reshard"
  | "sequence_of_actions"
  | "node_failure"
  | "proxy_failure"
  | "network_failure"
  | "shard_failure"
  | "execute_rlutil_command"
  | "execute_rladmin_command"
  | "migrate"
  | "bind"
  | "update_cluster_config"
  | "delete_database"
  | "create_database";

type ActionParameters = {
  [key: string]: unknown;
};

type ClusterScopedParameters = ActionParameters & {
  cluster_index?: number;
};

type BdbScopedParameters = ClusterScopedParameters & {
  bdb_id: string;
};

type BaseActionRequest<
  TType extends ActionType,
  TParameters extends ActionParameters | undefined = undefined,
> = TParameters extends ActionParameters
  ? {
      type: TType;
      parameters: TParameters;
    }
  : {
      type: TType;
      parameters?: undefined;
    };

export type DmcRestartActionRequest = BaseActionRequest<
  "dmc_restart",
  ClusterScopedParameters
>;

export type FailoverActionRequest = BaseActionRequest<
  "failover",
  BdbScopedParameters
>;

export type ReshardActionRequest = BaseActionRequest<
  "reshard",
  ActionParameters
>;

export type SequenceOfActionsActionRequest = BaseActionRequest<
  "sequence_of_actions",
  ActionParameters
>;

export type NodeFailureActionRequest = BaseActionRequest<
  "node_failure",
  ClusterScopedParameters & {
    node_id: number;
    method: "reboot" | "stop" | "start";
    shutdown_timeout?: number;
    startup_timeout?: number;
  }
>;

export type ProxyFailureActionRequest = BaseActionRequest<
  "proxy_failure",
  ClusterScopedParameters &
    (
      | {
          bdb_id: string;
          node_id?: never;
        }
      | {
          node_id: number;
          bdb_id?: never;
        }
    ) & {
      action?: "stop" | "start" | "restart";
    }
>;

export type NetworkFailureActionRequest = BaseActionRequest<
  "network_failure",
  BdbScopedParameters & {
    delay?: number;
  }
>;

export type ShardFailureActionRequest = BaseActionRequest<
  "shard_failure",
  BdbScopedParameters & {
    shard_id?: number;
    signal?: number;
  }
>;

export type ExecuteRlutilCommandActionRequest = BaseActionRequest<
  "execute_rlutil_command",
  ActionParameters
>;

export type ExecuteRladminCommandActionRequest = BaseActionRequest<
  "execute_rladmin_command",
  ActionParameters
>;

export type MigrateActionRequest = BaseActionRequest<"migrate", ActionParameters>;

export type BindActionRequest = BaseActionRequest<"bind", ActionParameters>;

export type UpdateClusterConfigActionRequest = BaseActionRequest<
  "update_cluster_config",
  ActionParameters
>;

export type DeleteDatabaseActionRequest = BaseActionRequest<
  "delete_database",
  ClusterScopedParameters & {
    bdb_id?: string;
    delete_all?: boolean;
  }
>;

export type CreateDatabaseActionRequest = BaseActionRequest<
  "create_database",
  ClusterScopedParameters & {
    database_config: CreateDatabaseConfig;
  }
>;

export type ActionRequest =
  | DmcRestartActionRequest
  | FailoverActionRequest
  | ReshardActionRequest
  | SequenceOfActionsActionRequest
  | NodeFailureActionRequest
  | ProxyFailureActionRequest
  | NetworkFailureActionRequest
  | ShardFailureActionRequest
  | ExecuteRlutilCommandActionRequest
  | ExecuteRladminCommandActionRequest
  | MigrateActionRequest
  | BindActionRequest
  | UpdateClusterConfigActionRequest
  | DeleteDatabaseActionRequest
  | CreateDatabaseActionRequest;

export interface ActionStatus {
  status: string;
  error: unknown;
  output: unknown;
}

interface DatabaseEndpoint {
  dns_name: string;
  port: number;
}

interface CreatedDatabaseResponse {
  bdb_id: number;
  username: string;
  password: string;
  tls: boolean;
  raw_endpoints: DatabaseEndpoint[];
}

export class FaultInjectorClient {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, ""); // trim trailing slash
    this.fetch = fetchImpl;
  }

  /**
   * Lists all available actions.
   * @throws {Error} When the HTTP request fails or response cannot be parsed as JSON
   */
  listActions<T = unknown>(): Promise<T> {
    return this.request<T>("GET", "/action");
  }

  /**
   * Triggers a specific action.
   * @param action The action request to trigger
   * @throws {Error} When the HTTP request fails or response cannot be parsed as JSON
   */
  triggerAction<T extends { action_id: string }>(
    action: ActionRequest
  ): Promise<T> {
    return this.request<T>("POST", "/action", action);
  }

  /**
   * Gets the status of a specific action.
   * @param actionId The ID of the action to check
   * @throws {Error} When the HTTP request fails or response cannot be parsed as JSON
   */
  getActionStatus<T = ActionStatus>(actionId: string): Promise<T> {
    return this.request<T>("GET", `/action/${actionId}`);
  }

  /**
   * Waits for an action to complete.
   * @param actionId The ID of the action to wait for
   * @param options Optional timeout and max wait time
   * @throws {Error} When the action does not complete within the max wait time
   */
  async waitForAction(
    actionId: string,
    {
      timeoutMs,
      maxWaitTimeMs,
    }: {
      timeoutMs?: number;
      maxWaitTimeMs?: number;
    } = {}
  ): Promise<ActionStatus> {
    const timeout = timeoutMs || 1000;
    const maxWaitTime = maxWaitTimeMs || 60000;

    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const action = await this.getActionStatus<ActionStatus>(actionId);

      if (action.status === "failed") {
        throw new Error(
          `Action id: ${actionId} failed! Error: ${action.error}`
        );
      } else if (["finished", "success"].includes(action.status)) {
        return action;
      }

      await wait(timeout);
    }

    throw new Error(`Timeout waiting for action ${actionId}`);
  }

  async createDatabase(
    databaseConfig: CreateDatabaseConfig,
    clusterIndex = 0
  ): Promise<RedisConnectionConfig> {
    const { action_id } = await this.triggerAction<{ action_id: string }>({
      type: "create_database",
      parameters: {
        cluster_index: clusterIndex,
        database_config: databaseConfig,
      },
    });

    const action = await this.waitForAction(action_id, {
      maxWaitTimeMs: 120_000,
    });
    const actionOutput = action.output;

    const dbConfig =
      typeof actionOutput === "string"
        ? (JSON.parse(actionOutput) as CreatedDatabaseResponse)
        : (actionOutput as CreatedDatabaseResponse);
    const endpoint = dbConfig.raw_endpoints[0];

    if (!endpoint) {
      throw new Error("No endpoints found in database config");
    }

    return {
      host: endpoint.dns_name,
      port: endpoint.port,
      username: dbConfig.username,
      password: dbConfig.password,
      tls: dbConfig.tls,
      bdbId: dbConfig.bdb_id,
    };
  }

  createClusterTestDatabase(namePrefix: string): Promise<RedisConnectionConfig> {
    return this.createDatabase(
      getCreateDatabaseConfig(CreateDatabaseConfigType.CLUSTER, namePrefix)
    );
  }

  async deleteDatabase(bdbId: number | string, clusterIndex = 0) {
    const { action_id } = await this.triggerAction<{ action_id: string }>({
      type: "delete_database",
      parameters: {
        cluster_index: clusterIndex,
        bdb_id: String(bdbId),
      },
    });

    return this.waitForAction(action_id, {
      maxWaitTimeMs: 120_000,
    });
  }

  async deleteDatabaseWithRetry(
    bdbId: number | string,
    {
      retryCount = 10,
      retryDelayMs = 5_000,
      clusterIndex = 0,
    }: {
      retryCount?: number;
      retryDelayMs?: number;
      clusterIndex?: number;
    } = {}
  ) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        await this.deleteDatabase(bdbId, clusterIndex);
        return;
      } catch (error) {
        lastError = error;

        if (
          !(error instanceof Error) ||
          !error.message.includes('"error_code":"db_busy"') ||
          attempt === retryCount
        ) {
          throw error;
        }

        await wait(retryDelayMs);
      }
    }

    throw lastError;
  }

  async request<T>(
    method: string,
    path: string,
    body?: object | string
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    let payload: string | undefined;

    if (body) {
      if (typeof body === "string") {
        headers["Content-Type"] = "text/plain";
        payload = body;
      } else {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
    }

    const response = await this.fetch(url, { method, headers, body: payload });

    if (!response.ok) {
      try {
        const text = await response.text();
        throw new Error(`HTTP ${response.status} - ${text}`);
      } catch {
        throw new Error(`HTTP ${response.status}`);
      }
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new Error(
        `HTTP ${response.status} - Unable to parse response as JSON`
      );
    }
  }
}
