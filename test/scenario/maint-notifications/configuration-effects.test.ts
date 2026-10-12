import { assert } from "chai";
import * as diagnostics_channel from "node:diagnostics_channel";
import type {
  MaintenanceNotification,
  MovingNotification,
} from "../../../lib/maintNotifications";
import { EffectRunner } from "../utils/effect-runner";
import { FaultInjectorClient } from "../utils/fault-injector";
import {
  createMaintenanceStartWait,
  MAINTENANCE_CHANNEL,
} from "../utils/maintenance-notifications";
import {
  createStandaloneTestClient,
  getFaultInjectorUrl,
  wait,
  waitClientReady,
  waitForAssertion,
} from "../utils/test.util";

describe("Configuration Effects E2E", function () {
  this.timeout(1_800_000);

  const effectRunner = new EffectRunner(
    new FaultInjectorClient(getFaultInjectorUrl())
  );

  effectRunner.it(
    "Receive maintenance notifications without a connection drop",
    "data_movement_no_conn_drop",
    async ({ databaseConfig, startEffect }) => {
      const client = createStandaloneTestClient(databaseConfig, {
        maintNotifications: "enabled",
      });
      const onError = () => {};
      client.on("error", onError);

      try {
        await waitClientReady(client);

        const maintenanceStart = createMaintenanceStartWait();
        try {
          await startEffect();
          const notification = await maintenanceStart.notification;

          assert.isDefined(
            notification,
            "The client should receive a maintenance notification"
          );
        } finally {
          maintenanceStart.stop();
        }
      } finally {
        client.disconnect();
        client.removeListener("error", onError);
      }
    }
  );

  effectRunner.it(
    "Receive maintenance notifications during a connection drop",
    "data_movement_conn_drop",
    async ({ databaseConfig, startEffect }) => {
      const client = createStandaloneTestClient(databaseConfig, {
        maintNotifications: "enabled",
      });
      const onError = () => {};
      client.on("error", onError);

      try {
        await waitClientReady(client);

        const maintenanceStart = createMaintenanceStartWait();
        try {
          await startEffect();
          const notification = await maintenanceStart.notification;

          assert.isDefined(
            notification,
            "The client should receive a maintenance notification"
          );
        } finally {
          maintenanceStart.stop();
        }
      } finally {
        client.disconnect();
        client.removeListener("error", onError);
      }
    }
  );

  effectRunner.it(
    "Handle an endpointless maintenance notification without crashing",
    "data_movement_conn_drop",
    async ({ databaseConfig, startEffect }) => {
      const client = createStandaloneTestClient(databaseConfig, {
        maintNotifications: "enabled",
        maintEndpointType: "none",
      });
      const errors: Error[] = [];
      let moving: MovingNotification | null = null;
      const onError = (error: Error) => errors.push(error);
      const onNotification = (message: unknown) => {
        const notification = message as MaintenanceNotification;
        if (notification.type === "MOVING" && moving === null) {
          moving = notification;
        }
      };
      client.on("error", onError);

      try {
        await waitClientReady(client);
        diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);

        const runningEffect = await startEffect();
        await runningEffect.waitForCompletion();

        await waitForAssertion(() => {
          assert.isNotNull(
            moving,
            "The client should receive a MOVING notification"
          );
        }, 30_000);
        assert.isNull(
          moving!.endpoint,
          "MOVING should not contain an endpoint when endpoint type is none"
        );

        await waitClientReady(client, 30_000);
        assert.strictEqual(
          client.status,
          "ready",
          "The client should remain ready after the endpointless notification"
        );
        assert.strictEqual(
          await client.ping(),
          "PONG",
          "PING should succeed after the endpointless notification"
        );
        assert.deepEqual(errors, [], "The client should emit no errors");
      } finally {
        diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);
        client.disconnect();
        client.removeListener("error", onError);
      }
    }
  );

  effectRunner.it(
    "Ignore maintenance notifications over RESP2 without a connection drop",
    "data_movement_no_conn_drop",
    async ({ databaseConfig, startEffect }) => {
      const client = createStandaloneTestClient(databaseConfig, {
        protocol: 2,
        maintNotifications: "enabled",
      });
      const onError = () => {};
      client.on("error", onError);
      const received: MaintenanceNotification[] = [];
      const onNotification = (message: unknown) => {
        received.push(message as MaintenanceNotification);
      };

      try {
        await waitClientReady(client);
        diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);

        const runningEffect = await startEffect();
        await runningEffect.waitForCompletion();
        await wait(2_000);

        assert.deepEqual(
          received,
          [],
          "RESP2 should not receive maintenance diagnostics"
        );
      } finally {
        diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);
        client.disconnect();
        client.removeListener("error", onError);
      }
    }
  );

  effectRunner.it(
    "Ignore maintenance notifications over RESP2 with a connection drop",
    "data_movement_conn_drop",
    async ({ databaseConfig, startEffect }) => {
      const client = createStandaloneTestClient(databaseConfig, {
        protocol: 2,
        maintNotifications: "enabled",
      });
      const onError = () => {};
      client.on("error", onError);
      const received: MaintenanceNotification[] = [];
      const onNotification = (message: unknown) => {
        received.push(message as MaintenanceNotification);
      };

      try {
        await waitClientReady(client);
        diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);

        const runningEffect = await startEffect();
        await runningEffect.waitForCompletion();
        await wait(2_000);

        assert.deepEqual(
          received,
          [],
          "RESP2 should not receive maintenance diagnostics"
        );
      } finally {
        diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);
        client.disconnect();
        client.removeListener("error", onError);
      }
    }
  );
});
