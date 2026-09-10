import { assert } from "chai";
import * as diagnostics_channel from "node:diagnostics_channel";
import type { Redis } from "../../../lib";
import type {
  MaintenanceNotification,
  MaintenanceNotificationType,
} from "../../../lib/maintNotifications";
import { FaultInjectorClient } from "../utils/fault-injector";
import type { RedisConnectionConfig } from "../utils/test.util";
import {
  createStandaloneTestClient,
  getConfig,
  wait,
  waitClientReady,
  waitForAssertion,
} from "../utils/test.util";

const MAINTENANCE_CHANNEL = "ioredis:maintenance";

interface RecordedNotification {
  receivedAt: number;
  notification: MaintenanceNotification;
}

describe("Maintenance Push Notifications E2E", function () {
  this.timeout(600_000);

  let faultInjectorClient: FaultInjectorClient;
  let databaseConfig: RedisConnectionConfig | null = null;
  let client: Redis | null = null;
  let received: RecordedNotification[] = [];

  const onNotification = (message: unknown) => {
    received.push({
      receivedAt: Date.now(),
      notification: message as MaintenanceNotification,
    });
  };

  const findByType = <T extends MaintenanceNotificationType>(type: T) =>
    received
      .map(({ notification }) => notification)
      .find(
        (
          notification
        ): notification is Extract<MaintenanceNotification, { type: T }> =>
          notification.type === type
      );

  before(() => {
    const config = getConfig();
    faultInjectorClient = new FaultInjectorClient(config.faultInjectorUrl);
  });

  beforeEach(async () => {
    received = [];
    diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);
    databaseConfig = await faultInjectorClient.createStandaloneTestDatabase(
      "maint-push"
    );
  });

  afterEach(async () => {
    diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);

    if (client) {
      client.disconnect();
      client = null;
    }

    // Server-side maintenance notifications are a cluster-level flag that
    // survives database deletion, so always restore it.
    await setServerMaintNotifications(true);

    if (databaseConfig) {
      await faultInjectorClient.deleteDatabaseWithRetry(databaseConfig.bdbId);
      databaseConfig = null;
    }
  });

  const setServerMaintNotifications = async (enabled: boolean) => {
    const { action_id: actionId } = await faultInjectorClient.triggerAction({
      type: "update_cluster_config",
      parameters: {
        config: { client_maint_notifications: enabled },
      },
    });

    await faultInjectorClient.waitForAction(actionId);
  };

  const triggerMigrateAndBind = async (bdbId: number) => {
    const { action_id: actionId } =
      await faultInjectorClient.migrateAndBindAction({ bdbId });

    await faultInjectorClient.waitForAction(actionId, {
      maxWaitTimeMs: 240_000,
    });
  };

  const triggerFailover = async (bdbId: number) => {
    const { action_id: actionId } = await faultInjectorClient.triggerAction({
      type: "failover",
      parameters: { bdb_id: String(bdbId), cluster_index: 0 },
    });

    await faultInjectorClient.waitForAction(actionId, {
      maxWaitTimeMs: 240_000,
    });
  };

  it("receives MOVING, MIGRATING and MIGRATED push notifications", async () => {
    client = createStandaloneTestClient(databaseConfig!, {
      maintNotifications: "enabled",
    });
    client.on("error", () => {
      // The server closes the old connection at the end of the MOVING grace
      // period; the client does not hand off yet, so ignore the resulting
      // connection errors and let it reconnect.
    });

    await waitClientReady(client);
    await triggerMigrateAndBind(databaseConfig!.bdbId);

    await waitForAssertion(() => {
      const counts: Record<string, number> = {};
      for (const { notification } of received) {
        counts[notification.type] = (counts[notification.type] ?? 0) + 1;
      }

      assert.strictEqual(
        counts["MIGRATING"] ?? 0,
        1,
        "Should have received exactly one MIGRATING notification"
      );
      assert.strictEqual(
        counts["MIGRATED"] ?? 0,
        1,
        "Should have received exactly one MIGRATED notification"
      );
      assert.strictEqual(
        counts["MOVING"] ?? 0,
        1,
        "Should have received exactly one MOVING notification"
      );

      const migrating = findByType("MIGRATING");
      const migrated = findByType("MIGRATED");

      assert.isNotEmpty(
        migrating?.shardIds,
        "MIGRATING should carry the migrating shard ids"
      );
      assert.deepEqual(
        migrated?.shardIds,
        migrating?.shardIds,
        "MIGRATED should reference the shards from MIGRATING"
      );
    }, 30_000);
  });

  it("receives FAILING_OVER and FAILED_OVER push notifications", async () => {
    client = createStandaloneTestClient(databaseConfig!, {
      maintNotifications: "enabled",
    });
    client.on("error", () => {
      // The proxy holds traffic during the shard failover; ignore any
      // connection errors and let the client reconnect.
    });

    await waitClientReady(client);
    await triggerFailover(databaseConfig!.bdbId);

    await waitForAssertion(() => {
      const counts: Record<string, number> = {};
      for (const { notification } of received) {
        counts[notification.type] = (counts[notification.type] ?? 0) + 1;
      }

      assert.strictEqual(
        counts["FAILING_OVER"] ?? 0,
        1,
        "Should have received exactly one FAILING_OVER notification"
      );
      assert.strictEqual(
        counts["FAILED_OVER"] ?? 0,
        1,
        "Should have received exactly one FAILED_OVER notification"
      );

      const failingOver = findByType("FAILING_OVER");
      const failedOver = findByType("FAILED_OVER");

      assert.isNotEmpty(
        failingOver?.shardIds,
        "FAILING_OVER should carry the failing-over shard ids"
      );
      assert.deepEqual(
        failedOver?.shardIds,
        failingOver?.shardIds,
        "FAILED_OVER should reference the shards from FAILING_OVER"
      );
    }, 30_000);
  });

  it("does NOT receive push notifications when disabled on the client", async () => {
    client = createStandaloneTestClient(databaseConfig!, {
      maintNotifications: "disabled",
    });
    client.on("error", () => {
      // Without a handoff the endpoint rebind hard-closes the connection.
    });

    await waitClientReady(client);
    await triggerMigrateAndBind(databaseConfig!.bdbId);

    // Give any unexpected in-flight pushes time to arrive before asserting.
    await wait(5_000);

    assert.strictEqual(
      received.length,
      0,
      "Should not have received any maintenance notifications"
    );
  });

  it("does NOT receive push notifications when disabled on the server", async () => {
    await setServerMaintNotifications(false);

    // The default "auto" registration must tolerate the server rejecting
    // CLIENT MAINT_NOTIFICATIONS and leave the connection usable.
    client = createStandaloneTestClient(databaseConfig!);
    client.on("error", () => {
      // Without a handoff the endpoint rebind hard-closes the connection.
    });

    await waitClientReady(client);
    await triggerMigrateAndBind(databaseConfig!.bdbId);

    await wait(5_000);

    assert.strictEqual(
      received.length,
      0,
      "Should not have received any maintenance notifications"
    );
  });
});
