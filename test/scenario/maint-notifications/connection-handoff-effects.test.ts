import { assert } from "chai";
import { isIP } from "net";
import * as diagnostics_channel from "node:diagnostics_channel";
import type { RedisOptions } from "../../../lib";
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

  const handoffCases: {
    title: string;
    options: Partial<RedisOptions>;
    key: string;
  }[] = [
    {
      title: "Move an active connection to a new external IP",
      options: {
        maintNotifications: "auto",
        maintEndpointType: "external-ip",
      },
      key: "handoff-external-ip",
    },
    {
      title: "Hand off the connection without a new endpoint",
      options: {
        maintNotifications: "auto",
        maintEndpointType: "none",
      },
      key: "handoff-with-none",
    },
    {
      title: "Negotiate and hand off to an external FQDN automatically",
      options: {
        maintNotifications: "auto",
        maintEndpointType: "external-fqdn",
      },
      key: "handoff-external-fqdn",
    },
    {
      title: "Negotiate and hand off with default maintenance options",
      options: {},
      key: "handoff-default",
    },
    {
      title:
        "Negotiate and hand off with explicit automatic maintenance options",
      options: {
        maintNotifications: "auto",
        maintEndpointType: "auto",
      },
      key: "handoff-auto",
    },
  ];

  for (const { title, options, key } of handoffCases) {
    effectRunner.it(
      title,
      "data_movement_conn_drop",
      async ({ databaseConfig, startEffect }) => {
        const client = createStandaloneTestClient(databaseConfig, options);
        const endpointType = options.maintEndpointType ?? "auto";
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

          assert.strictEqual(client.options.maintNotifications, "auto");
          assert.strictEqual(client.options.maintEndpointType, endpointType);
          const originalHost = client.options.host;
          const originalPort = client.options.port;
          const originalStream = client.stream;

          diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);
          client.on("error", onError);
          client.on("close", onClose);
          client.on("reconnecting", onReconnecting);

          const runningEffect = await startEffect();
          await runningEffect.waitForCompletion();

          await waitForAssertion(() => {
            assert.isNotNull(moving, "The client should receive MOVING");
            if (endpointType === "none") {
              assert.isNull(
                moving!.endpoint,
                "Endpoint-type none should produce a null MOVING endpoint"
              );
            } else {
              assert.isNotNull(
                moving!.endpoint,
                `${endpointType} MOVING should contain a new endpoint`
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
            }
            assert.notStrictEqual(
              client.stream,
              originalStream,
              "The client should own a replacement connection stream"
            );
            assert.strictEqual(
              client.status,
              "ready",
              "The adopted connection should be ready"
            );
          }, 60_000);

          if (endpointType === "none") {
            assert.strictEqual(
              client.options.host,
              originalHost,
              "An endpointless handoff should preserve the configured host"
            );
            assert.strictEqual(
              client.options.port,
              originalPort,
              "An endpointless handoff should preserve the configured port"
            );
          } else {
            assert.notStrictEqual(
              client.options.host,
              originalHost,
              "The adopted host should differ from the original host"
            );
          }
          if (endpointType === "external-fqdn") {
            assert.strictEqual(
              isIP(moving!.endpoint!.host),
              0,
              "The endpoint should be a hostname"
            );
          }
          const currentTime = Date.now().toString();
          assert.strictEqual(
            await client.set(key, currentTime),
            "OK",
            `SET should succeed after the ${endpointType} handoff`
          );
          assert.strictEqual(
            await client.get(key),
            currentTime,
            `GET should succeed after the ${endpointType} handoff`
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
  }

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
