import { assert } from "chai";
import * as diagnostics_channel from "node:diagnostics_channel";
import { WatchError } from "../../../lib";
import type { Redis } from "../../../lib";
import type {
  MaintenanceNotification,
  MovingNotification,
} from "../../../lib/maintNotifications";
import { FaultInjectorClient } from "../utils/fault-injector";
import type { RedisConnectionConfig } from "../utils/test.util";
import {
  createStandaloneTestClient,
  getConfig,
  waitClientReady,
  waitForAssertion,
} from "../utils/test.util";

const MAINTENANCE_CHANNEL = "ioredis:maintenance";

describe("Connection Handoff E2E", function () {
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
      "maint-handoff"
    );
    client = createStandaloneTestClient(databaseConfig, {
      maintNotifications: "enabled",
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

  it("hands the connection off during an endpoint rebind without disruption", async () => {
    const commandErrors: Error[] = [];
    const connectionEvents: string[] = [];
    let moving: MovingNotification | null = null;

    const onNotification = (message: unknown) => {
      const notification = message as MaintenanceNotification;
      if (notification.type === "MOVING" && !moving) {
        moving = notification;
      }
    };
    diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);

    client!.on("close", () => connectionEvents.push("close"));
    client!.on("reconnecting", () => connectionEvents.push("reconnecting"));
    client!.on("error", (err) => commandErrors.push(err));

    // Continuous traffic across the whole maintenance operation.
    let stopped = false;
    let completed = 0;
    const traffic = (async () => {
      let i = 0;
      while (!stopped) {
        try {
          await client!.set(`handoff-key-${i % 10}`, String(i));
          completed += 1;
        } catch (err) {
          commandErrors.push(err as Error);
        }
        i += 1;
      }
    })();

    try {
      const { action_id: actionId } =
        await faultInjectorClient.migrateAndBindAction({
          bdbId: databaseConfig!.bdbId,
        });
      await faultInjectorClient.waitForAction(actionId, {
        maxWaitTimeMs: 240_000,
      });

      await waitForAssertion(() => {
        assert.isNotNull(moving, "Should have received a MOVING notification");
      }, 30_000);

      // Let traffic run a little past the completed rebind.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } finally {
      stopped = true;
      await traffic;
      diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);
    }

    assert.isNotNull(moving!.endpoint, "MOVING should carry an endpoint");
    assert.deepEqual(
      commandErrors,
      [],
      "No command should fail during the handoff"
    );
    assert.deepEqual(
      connectionEvents,
      [],
      "The client should not disconnect or reconnect during the handoff"
    );
    assert.isAbove(completed, 0, "Traffic should have flowed throughout");

    // The client now talks to the endpoint announced by MOVING.
    assert.strictEqual((client as any).options.host, moving!.endpoint!.host);
    assert.strictEqual((client as any).options.port, moving!.endpoint!.port);
    assert.strictEqual(client!.status, "ready");
    assert.strictEqual(await client!.ping(), "PONG");
  });

  it("rejects a transaction whose WATCH the handoff invalidated", async () => {
    let moving: MovingNotification | null = null;

    const onNotification = (message: unknown) => {
      const notification = message as MaintenanceNotification;
      if (notification.type === "MOVING" && !moving) {
        moving = notification;
      }
    };
    diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);

    try {
      // Optimistic lock established on the original connection.
      await client!.set("watched-key", "before");
      await client!.watch("watched-key");

      const { action_id: actionId } =
        await faultInjectorClient.migrateAndBindAction({
          bdbId: databaseConfig!.bdbId,
        });
      await faultInjectorClient.waitForAction(actionId, {
        maxWaitTimeMs: 240_000,
      });

      await waitForAssertion(() => {
        assert.isNotNull(moving, "Should have received a MOVING notification");
        assert.isNotNull(moving!.endpoint, "MOVING should carry an endpoint");
        // The handoff has completed once the client targets the new endpoint.
        assert.strictEqual((client as any).options.host, moving!.endpoint!.host);
      }, 30_000);

      // The watch set died with the replaced connection: the transaction
      // must abort before execution instead of committing without the lock.
      const error = await client!
        .multi()
        .set("watched-key", "dirty")
        .exec()
        .then(
          () => null,
          (err: Error) => err
        );
      assert.instanceOf(error, WatchError);
      assert.strictEqual(
        await client!.get("watched-key"),
        "before",
        "The aborted transaction must not have executed"
      );

      // The rejection reset the watch state, so the standard optimistic-lock
      // retry pattern works on the adopted connection.
      await client!.watch("watched-key");
      const retried = await client!.multi().set("watched-key", "after").exec();
      assert.deepEqual(retried, [[null, "OK"]]);
      assert.strictEqual(await client!.get("watched-key"), "after");
    } finally {
      diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);
    }
  });
});
