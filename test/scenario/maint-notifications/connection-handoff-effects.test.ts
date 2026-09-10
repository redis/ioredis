import { assert } from "chai";
import * as diagnostics_channel from "node:diagnostics_channel";
import type {
  MaintenanceNotification,
  MovingNotification,
} from "../../../lib/maintNotifications";
import { EffectRunner } from "../utils/effect-runner";
import { FaultInjectorClient } from "../utils/fault-injector";
import { MAINTENANCE_CHANNEL } from "../utils/maintenance-notifications";
import {
  createStandaloneTestClient,
  getFaultInjectorUrl,
  waitClientReady,
  waitForAssertion,
} from "../utils/test.util";

describe("Connection Handoff Effects E2E", function () {
  this.timeout(1_800_000);

  const effectRunner = new EffectRunner(
    new FaultInjectorClient(getFaultInjectorUrl())
  );

  effectRunner.it(
    "Move an active connection to a new external IP",
    "data_movement_conn_drop",
    async ({ databaseConfig, startEffect }) => {
      const client = createStandaloneTestClient(databaseConfig, {
        maintNotifications: "enabled",
        maintEndpointType: "external-ip",
      });
      const errors: Error[] = [];
      const closeEvents: string[] = [];
      const reconnectEvents: string[] = [];
      let moving: MovingNotification | null = null;

      const onNotification = (message: unknown) => {
        const notification = message as MaintenanceNotification;
        if (notification.type === "MOVING" && moving === null) {
          moving = notification;
        }
      };
      const onError = (error: Error) => errors.push(error);
      const onClose = () => closeEvents.push("close");
      const onReconnecting = () => reconnectEvents.push("reconnecting");

      try {
        await waitClientReady(client, 30_000);

        const originalHost = client.options.host;
        const originalStream = client.stream;

        diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);
        client.on("error", onError);
        client.on("close", onClose);
        client.on("reconnecting", onReconnecting);

        const runningEffect = await startEffect();
        await runningEffect.waitForCompletion();

        await waitForAssertion(() => {
          assert.isNotNull(moving, "The client should receive MOVING");
          assert.isNotNull(
            moving!.endpoint,
            "External-IP MOVING should contain a new endpoint"
          );
          assert.notStrictEqual(
            client.stream,
            originalStream,
            "The client should own a replacement connection stream"
          );
          assert.strictEqual(
            client.options.host,
            moving!.endpoint!.host,
            "The client should adopt the notification host"
          );
          assert.strictEqual(
            client.options.port,
            moving!.endpoint!.port,
            "The client should adopt the notification port"
          );
          assert.strictEqual(
            client.status,
            "ready",
            "The adopted connection should be ready"
          );
        }, 60_000);

        assert.notStrictEqual(
          client.options.host,
          originalHost,
          "The adopted host should differ from the original host"
        );
        const currentTime = Date.now().toString();
        assert.strictEqual(
          await client.set("handoff-external-ip", currentTime),
          "OK",
          "SET should succeed after the external-IP handoff"
        );
        assert.strictEqual(
          await client.get("handoff-external-ip"),
          currentTime,
          "GET should succeed after the external-IP handoff"
        );
        assert.deepEqual(errors, [], "The client should emit no errors");
        assert.deepEqual(
          closeEvents,
          [],
          "The client should emit no close events"
        );
        assert.deepEqual(
          reconnectEvents,
          [],
          "The client should make no reconnect attempts"
        );
      } finally {
        diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);
        client.removeListener("error", onError);
        client.removeListener("close", onClose);
        client.removeListener("reconnecting", onReconnecting);
        client.disconnect();
      }
    }
  );

  effectRunner.it(
    "Hand off the connection without a new endpoint",
    "data_movement_conn_drop",
    async ({ databaseConfig, startEffect }) => {
      const client = createStandaloneTestClient(databaseConfig, {
        maintNotifications: "enabled",
        maintEndpointType: "none",
      });
      const errors: Error[] = [];
      const closeEvents: string[] = [];
      const reconnectEvents: string[] = [];
      let moving: MovingNotification | null = null;

      const onNotification = (message: unknown) => {
        const notification = message as MaintenanceNotification;
        if (notification.type === "MOVING" && moving === null) {
          moving = notification;
        }
      };
      const onError = (error: Error) => errors.push(error);
      const onClose = () => closeEvents.push("close");
      const onReconnecting = () => reconnectEvents.push("reconnecting");

      try {
        await waitClientReady(client, 30_000);

        const configuredHost = client.options.host;
        const configuredPort = client.options.port;
        const originalStream = client.stream;

        diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);
        client.on("error", onError);
        client.on("close", onClose);
        client.on("reconnecting", onReconnecting);

        const runningEffect = await startEffect();
        await runningEffect.waitForCompletion();

        await waitForAssertion(() => {
          assert.isNotNull(moving, "The client should receive MOVING");
          assert.isNull(
            moving!.endpoint,
            "Endpoint-type none should produce a null MOVING endpoint"
          );
          assert.notStrictEqual(
            client.stream,
            originalStream,
            "The client should own a replacement connection stream"
          );
        }, 60_000);

        assert.strictEqual(
          client.options.host,
          configuredHost,
          "An endpointless handoff should preserve the configured host"
        );
        assert.strictEqual(
          client.options.port,
          configuredPort,
          "An endpointless handoff should preserve the configured port"
        );
        assert.strictEqual(
          await client.set("handoff-with-none", "complete"),
          "OK",
          "SET should succeed after the endpointless handoff"
        );
        assert.strictEqual(
          await client.get("handoff-with-none"),
          "complete",
          "GET should succeed after the endpointless handoff"
        );
        assert.deepEqual(errors, [], "The client should emit no errors");
        assert.deepEqual(
          closeEvents,
          [],
          "The client should emit no close events"
        );
        assert.deepEqual(
          reconnectEvents,
          [],
          "The client should make no reconnect attempts"
        );
      } finally {
        diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);
        client.removeListener("error", onError);
        client.removeListener("close", onClose);
        client.removeListener("reconnecting", onReconnecting);
        client.disconnect();
      }
    }
  );

  effectRunner.it(
    "Shut down the old connection after a handoff",
    "data_movement_conn_drop",
    async ({ databaseConfig, startEffect }) => {
      const client = createStandaloneTestClient(databaseConfig, {
        maintNotifications: "enabled",
      });

      try {
        await waitClientReady(client, 30_000);

        const originalStream = client.stream;
        const runningEffect = await startEffect();
        await runningEffect.waitForCompletion();

        await waitForAssertion(() => {
          assert.notStrictEqual(
            client.stream,
            originalStream,
            "The client should own a replacement connection stream"
          );
          assert.isTrue(
            originalStream.destroyed,
            "The original connection stream should be destroyed"
          );
          assert.strictEqual(
            originalStream.listenerCount("data"),
            0,
            "The original stream should retain no client data listeners"
          );
          assert.strictEqual(
            originalStream.listenerCount("error"),
            0,
            "The original stream should retain no client error listeners"
          );
          assert.strictEqual(
            originalStream.listenerCount("close"),
            0,
            "The original stream should retain no client close listeners"
          );
        }, 60_000);
      } finally {
        client.disconnect();
      }
    }
  );
});
