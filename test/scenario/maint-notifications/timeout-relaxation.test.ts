import { assert } from "chai";
import * as diagnostics_channel from "node:diagnostics_channel";
import type { Redis } from "../../../lib";
import type { MaintenanceNotification } from "../../../lib/maintNotifications";
import type MaintenanceManager from "../../../lib/maintNotifications/MaintenanceManager";
import { EffectRunner } from "../utils/effect-runner";
import { FaultInjectorClient } from "../utils/fault-injector";
import {
  createMaintenanceStartWait,
  MAINTENANCE_CHANNEL,
} from "../utils/maintenance-notifications";
import type { RedisConnectionConfig } from "../utils/test.util";
import {
  createStandaloneTestClient,
  getFaultInjectorUrl,
  waitClientReady,
  waitForAssertion,
} from "../utils/test.util";

const NORMAL_COMMAND_TIMEOUT = 100;
const RELAXED_COMMAND_TIMEOUT = 2_000;

/**
 * The effects this suite exercises. Timeout relaxation needs the maintenance
 * windows that only the data movement effects open: the conn-drop variant
 * rebinds the endpoint and emits MIGRATING and MOVING, while the no-conn-drop
 * variant keeps the connection alive across a maintenance window
 * (MIGRATING/MIGRATED or FAILING_OVER/FAILED_OVER, depending on the
 * discovered trigger). The pure conn_drop and dns_resolution_change effects
 * open no such window here.
 */
const SUITE_EFFECTS = [
  "data_movement_no_conn_drop",
  "data_movement_conn_drop",
] as const;

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
  // Every test runs once per discovered (trigger, database config)
  // combination and provisions a dedicated database for each run.
  this.timeout(1_800_000);

  const effectRunner = new EffectRunner(
    new FaultInjectorClient(getFaultInjectorUrl())
  );

  interface TrackedClient {
    client: Redis;
    errors: Error[];
    events: string[];
    stopTracking: () => void;
  }

  /**
   * Creates a maintenance-enabled client that records every connection-level
   * error and lifecycle event, so tests can assert that a maintenance window
   * was handled without the application noticing. A handoff swaps the
   * transport in place, so a healthy run records nothing at all.
   */
  const createTimeoutTestClient = async (
    databaseConfig: RedisConnectionConfig
  ): Promise<TrackedClient> => {
    const client = createStandaloneTestClient(databaseConfig, {
      maintNotifications: "enabled",
      commandTimeout: NORMAL_COMMAND_TIMEOUT,
      maintRelaxedCommandTimeout: RELAXED_COMMAND_TIMEOUT,
    });

    const errors: Error[] = [];
    const events: string[] = [];
    // The collector doubles as the "error" handler that keeps Node from
    // treating an unhandled error event as fatal.
    const onError = (err: Error) => errors.push(err);
    const onClose = () => events.push("close");
    const onReconnecting = () => events.push("reconnecting");
    const onEnd = () => events.push("end");
    client.on("error", onError);
    client.on("close", onClose);
    client.on("reconnecting", onReconnecting);
    client.on("end", onEnd);

    const stopTracking = () => {
      client.removeListener("error", onError);
      client.removeListener("close", onClose);
      client.removeListener("reconnecting", onReconnecting);
      client.removeListener("end", onEnd);
      // Keep swallowing errors once tracking stops, e.g. during teardown.
      client.on("error", () => {});
    };

    try {
      await waitClientReady(client);
    } catch (error) {
      // The caller never receives the client, so it must be torn down here
      // or its retry strategy keeps reconnecting for the rest of the run.
      stopTracking();
      client.disconnect();
      throw error;
    }
    return { client, errors, events, stopTracking };
  };

  /**
   * Asserts the maintenance window was invisible to the application: no
   * errors, no disconnect/reconnect cycle, and the client still ready.
   */
  const assertSeamlessConnection = ({
    client,
    errors,
    events,
  }: TrackedClient) => {
    assert.deepEqual(errors, [], "The client should emit no errors");
    assert.deepEqual(
      events,
      [],
      "The client should not disconnect or reconnect"
    );
    assert.strictEqual(client.status, "ready");
  };

  // Only the conn-drop data movement rebinds the endpoint, so it is the
  // effect that emits both MIGRATING and MOVING. The MIGRATING command
  // observes the relaxed timeout while the migration keeps the window open;
  // the MOVING command keeps the relaxed timeout assigned when it was issued,
  // even if the handoff closes the window before its deadline.
  effectRunner.it(
    "keeps relaxed command timeouts assigned during MIGRATING and MOVING",
    "data_movement_conn_drop",
    async ({ databaseConfig, startEffect }) => {
      const tracked = await createTimeoutTestClient(databaseConfig);
      const { client } = tracked;

      const releaseBlockingCommand = async (key: string) => {
        const unblocker = client.duplicate({
          maintNotifications: "disabled",
          connectionName: "timeout-unblocker",
          commandTimeout: 5_000,
          retryStrategy: () => undefined,
        });
        unblocker.on("error", () => {});

        try {
          await waitClientReady(unblocker);
          await unblocker.lpush(key, "release");
          await waitForAssertion(() => {
            assert.strictEqual((client as any).commandQueue.length, 0);
          }, 5_000);
        } finally {
          unblocker.disconnect();
        }
      };

      const measurements: Record<string, TimeoutMeasurement> = {};
      const measurementTasks: Record<string, Promise<void>> = {};
      const onNotification = (message: unknown) => {
        const { type } = message as MaintenanceNotification;
        if (
          (type === "MIGRATING" || type === "MOVING") &&
          !measurementTasks[type]
        ) {
          const task = new Promise<void>((resolve, reject) => {
            setImmediate(async () => {
              const key = `during-${type}`;
              try {
                measurements[type] = await measureCommandTimeout(client, key);
                await releaseBlockingCommand(key);
                resolve();
              } catch (err) {
                reject(err);
              }
            });
          });
          measurementTasks[type] = task;
          void task.catch(() => {});
        }
      };
      diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);

      try {
        // Release the server-side blocking command after its client-side
        // timeout so it cannot prevent the later handoff from draining.
        assertNormalTimeout(await measureCommandTimeout(client, "baseline"));
        await releaseBlockingCommand("baseline");

        const runningEffect = await startEffect();
        await runningEffect.waitForCompletion();

        await waitForAssertion(() => {
          assert.property(measurementTasks, "MIGRATING");
          assert.property(measurementTasks, "MOVING");
        }, 30_000);
        await Promise.all(Object.values(measurementTasks));

        assertRelaxedTimeout(measurements["MIGRATING"]);
        assertRelaxedTimeout(measurements["MOVING"]);
        assertSeamlessConnection(tracked);
        assert.strictEqual((client as any).commandQueue.length, 0);
      } finally {
        diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);
        tracked.stopTracking();
        client.disconnect();
      }
    }
  );

  // The no-conn-drop data movement keeps the connection alive for the whole
  // maintenance window, so the silence measurement is not interrupted.
  effectRunner.it(
    "relaxes the socket timeout during maintenance",
    "data_movement_no_conn_drop",
    async ({ databaseConfig, startEffect }) => {
      const SOCKET_TIMEOUT = 500;
      const RELAXED_SOCKET_TIMEOUT = 3_000;
      const createSocketTestClient = () => {
        const socketClient = createStandaloneTestClient(databaseConfig, {
          maintNotifications: "enabled",
          socketTimeout: SOCKET_TIMEOUT,
          maintRelaxedSocketTimeout: RELAXED_SOCKET_TIMEOUT,
          // Each client measures one timeout. Retrying would only resend
          // the infinite BLPOP and create unrelated reconnect cycles.
          retryStrategy: () => undefined,
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

      // The same silence during a maintenance window must be tolerated up
      // to the relaxed socket timeout.
      const relaxed = createSocketTestClient();
      const maintenanceStart = createMaintenanceStartWait();
      try {
        await waitClientReady(relaxed.socketClient);

        const runningEffect = await startEffect();
        await maintenanceStart.notification;

        const start = Date.now();
        relaxed.socketClient.blpop("socket-relaxed", 0).catch(() => {});
        const err = await relaxed.socketError;
        const duration = Date.now() - start;

        assert.strictEqual(err.name, "SocketTimeoutDuringMaintenanceError");
        assert.isAtLeast(duration, RELAXED_SOCKET_TIMEOUT * 0.8);
        assert.isBelow(duration, RELAXED_SOCKET_TIMEOUT * 2);

        await runningEffect.waitForCompletion();
      } finally {
        maintenanceStart.stop();
        relaxed.socketClient.disconnect();
      }
    }
  );

  // The no-conn-drop windows close on their end notifications (MIGRATED or
  // FAILED_OVER, trigger-dependent). MOVING has no end notification: the
  // window closes when the handoff to the new endpoint completes, or on
  // its own deadline (conn-drop effect). The effect action outlives both,
  // so once it completes the client must be back to normal timeouts.
  // (Test 1 covers commands already pending when the windows close; this
  // one covers commands issued afterwards.)
  for (const effect of SUITE_EFFECTS) {
    effectRunner.it(
      "restores normal command timeouts after the windows close",
      effect,
      async ({ effect, databaseConfig, startEffect }) => {
        const tracked = await createTimeoutTestClient(databaseConfig);
        const { client } = tracked;
        const maintenanceStart = createMaintenanceStartWait();

        try {
          const manager = (client as any)
            .maintenanceManager as MaintenanceManager;

          const runningEffect = await startEffect();

          // Observe the start notification before waiting for the effect and
          // the corresponding maintenance window to finish.
          await maintenanceStart.notification;

          await runningEffect.waitForCompletion();

          await waitForAssertion(() => {
            assert.strictEqual(manager.isMaintenanceActive(), false);
          }, 60_000);
          await waitClientReady(client, 30_000);

          assertNormalTimeout(
            await measureCommandTimeout(client, `after-${effect}`)
          );
          assertSeamlessConnection(tracked);
        } finally {
          maintenanceStart.stop();
          tracked.stopTracking();
          client.disconnect();
        }
      }
    );
  }
});
