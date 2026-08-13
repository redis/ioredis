import { assert } from "chai";
import * as diagnostics_channel from "node:diagnostics_channel";
import type { Redis } from "../../../lib";
import type { MaintenanceNotification } from "../../../lib/maintNotifications";
import type MaintenanceManager from "../../../lib/maintNotifications/MaintenanceManager";
import { FaultInjectorClient } from "../utils/fault-injector";
import type { RedisConnectionConfig } from "../utils/test.util";
import {
  createStandaloneTestClient,
  getConfig,
  waitClientReady,
  waitForAssertion,
} from "../utils/test.util";

const MAINTENANCE_CHANNEL = "ioredis:maintenance";

const NORMAL_COMMAND_TIMEOUT = 100;
const RELAXED_COMMAND_TIMEOUT = 2_000;

interface TimeoutMeasurement {
  error: Error | null;
  duration: number;
}

/**
 * Issues a command that the server never answers (BLPOP with an infinite
 * server-side timeout), so the duration measures the client-side command
 * timeout.
 */
const measureCommandTimeout = async (
  client: Redis,
  key: string
): Promise<TimeoutMeasurement> => {
  const start = Date.now();
  try {
    await client.blpop(key, 0);
    return { error: null, duration: Date.now() - start };
  } catch (error) {
    return { error: error as Error, duration: Date.now() - start };
  }
};

const assertNormalTimeout = ({ error, duration }: TimeoutMeasurement) => {
  assert.instanceOf(error, Error);
  assert.strictEqual(error!.message, "Command timed out");
  assert.isAtLeast(duration, NORMAL_COMMAND_TIMEOUT);
  assert.isBelow(duration, RELAXED_COMMAND_TIMEOUT * 0.8);
};

const assertRelaxedTimeout = ({ error, duration }: TimeoutMeasurement) => {
  assert.instanceOf(error, Error);
  assert.strictEqual(error!.name, "CommandTimeoutDuringMaintenanceError");
  assert.isAtLeast(duration, RELAXED_COMMAND_TIMEOUT * 0.8);
  assert.isBelow(duration, RELAXED_COMMAND_TIMEOUT * 1.5);
};

describe("Timeout Relaxation During Maintenance E2E", function () {
  this.timeout(600_000);

  let faultInjectorClient: FaultInjectorClient;
  let databaseConfig: RedisConnectionConfig | null = null;
  let client: Redis | null = null;

  before(() => {
    const config = getConfig();
    faultInjectorClient = new FaultInjectorClient(config.faultInjectorUrl);
  });

  beforeEach(async () => {
    databaseConfig = await faultInjectorClient.createStandaloneTestDatabase(
      "maint-timeout"
    );
    client = createStandaloneTestClient(databaseConfig, {
      maintNotifications: "enabled",
      commandTimeout: NORMAL_COMMAND_TIMEOUT,
      maintRelaxedCommandTimeout: RELAXED_COMMAND_TIMEOUT,
    });
    client.on("error", () => {
      // Without a handoff the endpoint rebind hard-closes the connection;
      // let the client reconnect.
    });
    await waitClientReady(client);
  });

  afterEach(async () => {
    if (client) {
      client.disconnect();
      client = null;
    }

    if (databaseConfig) {
      await faultInjectorClient.deleteDatabaseWithRetry(databaseConfig.bdbId);
      databaseConfig = null;
    }
  });

  it("relaxes command timeouts on MIGRATING and MOVING", async () => {
    // Baseline outside any maintenance window.
    assertNormalTimeout(await measureCommandTimeout(client!, "baseline"));

    // Measure the command timeout the moment each notification arrives.
    const measurements: Record<string, TimeoutMeasurement> = {};
    const onNotification = (message: unknown) => {
      const { type } = message as MaintenanceNotification;
      if ((type === "MIGRATING" || type === "MOVING") && !measurements[type]) {
        setImmediate(async () => {
          measurements[type] = await measureCommandTimeout(
            client!,
            `during-${type}`
          );
        });
      }
    };
    diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);

    try {
      const { action_id: actionId } =
        await faultInjectorClient.migrateAndBindAction({
          bdbId: databaseConfig!.bdbId,
        });
      await faultInjectorClient.waitForAction(actionId, {
        maxWaitTimeMs: 240_000,
      });

      await waitForAssertion(() => {
        assert.property(measurements, "MIGRATING");
        assert.property(measurements, "MOVING");
      }, 30_000);
    } finally {
      diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);
    }

    assertRelaxedTimeout(measurements["MIGRATING"]);
    assertRelaxedTimeout(measurements["MOVING"]);
  });

  it("relaxes the socket timeout during maintenance", async () => {
    const SOCKET_TIMEOUT = 500;
    const RELAXED_SOCKET_TIMEOUT = 3_000;

    const createSocketTestClient = () => {
      const socketClient = createStandaloneTestClient(databaseConfig!, {
        maintNotifications: "enabled",
        socketTimeout: SOCKET_TIMEOUT,
        maintRelaxedSocketTimeout: RELAXED_SOCKET_TIMEOUT,
      });
      const socketError = new Promise<Error>((resolve) =>
        socketClient.on("error", (err) => {
          if (err.message.startsWith("Socket timeout")) {
            resolve(err);
          }
        })
      );
      return { socketClient, socketError };
    };

    // Baseline: server silence on a blocking command trips the normal
    // socket timeout.
    const baseline = createSocketTestClient();
    try {
      await waitClientReady(baseline.socketClient);

      const start = Date.now();
      baseline.socketClient.blpop("socket-baseline", 0).catch(() => {});
      const err = await baseline.socketError;
      const duration = Date.now() - start;

      assert.strictEqual(err.name, "Error");
      assert.isAtLeast(duration, SOCKET_TIMEOUT);
      assert.isBelow(duration, RELAXED_SOCKET_TIMEOUT * 0.8);
    } finally {
      baseline.socketClient.disconnect();
    }

    // The same silence during a MIGRATING window must be tolerated up to
    // the relaxed socket timeout.
    const relaxed = createSocketTestClient();
    try {
      await waitClientReady(relaxed.socketClient);
      const manager = (relaxed.socketClient as any)
        .maintenanceManager as MaintenanceManager;

      const { action_id: actionId } = await faultInjectorClient.triggerAction({
        type: "migrate",
        parameters: {
          cluster_index: "0",
          bdb_id: String(databaseConfig!.bdbId),
        },
      });

      await waitForAssertion(() => {
        assert.strictEqual(manager.isMaintenanceActive(), true);
      }, 120_000);

      const start = Date.now();
      relaxed.socketClient.blpop("socket-relaxed", 0).catch(() => {});
      const err = await relaxed.socketError;
      const duration = Date.now() - start;

      assert.strictEqual(err.name, "SocketTimeoutDuringMaintenanceError");
      assert.isAtLeast(duration, RELAXED_SOCKET_TIMEOUT * 0.8);
      assert.isBelow(duration, RELAXED_SOCKET_TIMEOUT * 2);

      await faultInjectorClient.waitForAction(actionId, {
        maxWaitTimeMs: 240_000,
      });
    } finally {
      relaxed.socketClient.disconnect();
    }
  });

  it("restores normal command timeouts after the windows close", async () => {
    const manager = (client as any).maintenanceManager as MaintenanceManager;

    // MIGRATED closes the migration window as soon as the migrate action
    // finishes, so the timeout must be back to normal.
    const { action_id: migrateActionId } =
      await faultInjectorClient.triggerAction({
        type: "migrate",
        parameters: {
          cluster_index: "0",
          bdb_id: String(databaseConfig!.bdbId),
        },
      });
    await faultInjectorClient.waitForAction(migrateActionId, {
      maxWaitTimeMs: 240_000,
    });
    await waitForAssertion(() => {
      assert.strictEqual(manager.isMaintenanceActive(), false);
    }, 30_000);

    assertNormalTimeout(await measureCommandTimeout(client!, "after-migrate"));

    // MOVING has no end notification: the window closes on its own deadline
    // or when the server drops the connection at the end of the grace
    // period. The bind action outlives both, so once it completes the client
    // must be back to normal timeouts. (Test 1 measures the relaxed timeout
    // while MOVING is still active.)
    const { action_id: bindActionId } = await faultInjectorClient.triggerAction(
      {
        type: "bind",
        parameters: {
          cluster_index: "0",
          bdb_id: String(databaseConfig!.bdbId),
        },
      }
    );
    await faultInjectorClient.waitForAction(bindActionId, {
      maxWaitTimeMs: 240_000,
    });

    await waitForAssertion(() => {
      assert.strictEqual(manager.isMaintenanceActive(), false);
    }, 60_000);
    await waitClientReady(client!, 30_000);

    assertNormalTimeout(await measureCommandTimeout(client!, "after-moving"));
  });
});
