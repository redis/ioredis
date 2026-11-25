import { assert } from "chai";
import type { RedisOptions } from "../../../lib";
import { TestCommandRunner } from "../utils/command-runner";
import type { ActionRequest } from "../utils/fault-injector";
import { FaultInjectorClient } from "../utils/fault-injector";
import type { RedisConnectionConfig } from "../utils/test.util";
import {
  createStandaloneTestClient,
  getFaultInjectorUrl,
  waitClientReady,
  waitForAssertion,
} from "../utils/test.util";

const CLUSTER_INDEX = 0;
const KEY = "regular-data-operations";
const ACTION_TIMEOUT_MS = 240_000;
// TCP retransmission backoff can hold a blackholed connection well past the
// end of the fault.
const RECOVERY_TIMEOUT_MS = 60_000;

// Smart Client Handoff is disabled: the default `maintNotifications: "auto"`
// would register for it on RESP3 and exercise the handoff path as well. The
// short command timeout makes commands that wait out the fault fail, so the
// workload shows the fault disrupted it. The socket timeout, shorter than the
// network blackhole, makes the client close a connection that stopped
// answering, so it reconnects whether or not the server closes it.
const NO_SCH_OPTIONS: Partial<RedisOptions> = {
  maintNotifications: "disabled",
  commandTimeout: 100,
  socketTimeout: 5_000,
};

describe("Regular Data Operations E2E", () => {
  let faultInjectorClient: FaultInjectorClient;
  let databaseConfig: RedisConnectionConfig | null = null;
  let cleanup: (() => void) | null = null;
  let pendingRestoreAction: ActionRequest | null = null;

  const runAction = async (action: ActionRequest) => {
    const { action_id } = await faultInjectorClient.triggerAction(action);
    await faultInjectorClient.waitForAction(action_id, {
      maxWaitTimeMs: ACTION_TIMEOUT_MS,
    });
  };

  const failureCases: Array<{
    name: string;
    createAction: (bdbId: number) => ActionRequest;
    /** Lifts the fault, for actions that do not lift it themselves. */
    createRestoreAction?: (bdbId: number) => ActionRequest;
  }> = [
    {
      name: "should keep regular data operations working when the proxy restarts (connection dropped)",
      createAction: (bdbId) => ({
        type: "proxy_failure",
        parameters: {
          bdb_id: bdbId.toString(),
          cluster_index: CLUSTER_INDEX,
          action: "restart",
          wait_for_active: true,
        },
      }),
    },
    {
      name: "should keep regular data operations working while the proxy is stopped (connection refused)",
      createAction: (bdbId) => ({
        type: "proxy_failure",
        parameters: {
          bdb_id: bdbId.toString(),
          cluster_index: CLUSTER_INDEX,
          action: "stop",
        },
      }),
      // The fault injector never undoes a stop.
      createRestoreAction: (bdbId) => ({
        type: "proxy_failure",
        parameters: {
          bdb_id: bdbId.toString(),
          cluster_index: CLUSTER_INDEX,
          action: "start",
          wait_for_active: true,
        },
      }),
    },
    {
      // network_failure blackholes the nodes (iptables DROP, no RST), so it
      // only produces timeouts. It lasts longer than the socket timeout.
      name: "should keep regular data operations working through a network blackhole (connection timeout)",
      createAction: (bdbId) => ({
        type: "network_failure",
        parameters: {
          bdb_id: bdbId.toString(),
          cluster_index: CLUSTER_INDEX,
          delay: 10,
        },
      }),
    },
  ];

  before(() => {
    faultInjectorClient = new FaultInjectorClient(getFaultInjectorUrl());
  });

  beforeEach(async function () {
    this.timeout(120_000);

    databaseConfig = await faultInjectorClient.createStandaloneTestDatabase(
      "regular-data-operations"
    );
  });

  afterEach(async function () {
    this.timeout(600_000);

    // Stops the workload and the client, so a failing test cannot leave the
    // workload looping on the disconnected client.
    cleanup?.();
    cleanup = null;

    try {
      // A stopped proxy outlives the database, so restore even when the test
      // failed before restoring, or the action's response was lost.
      // Starting a running proxy is harmless.
      if (pendingRestoreAction) {
        await runAction(pendingRestoreAction);
      }
    } finally {
      pendingRestoreAction = null;
      try {
        if (databaseConfig) {
          await faultInjectorClient.deleteDatabaseWithRetry(
            databaseConfig.bdbId
          );
        }
      } finally {
        databaseConfig = null;
      }
    }
  });

  for (const failureCase of failureCases) {
    it(failureCase.name, async function () {
      this.timeout(600_000);

      if (!databaseConfig) {
        throw new Error("Current database config was not initialized");
      }
      const { bdbId } = databaseConfig;

      const client = createStandaloneTestClient(databaseConfig, NO_SCH_OPTIONS);
      client.on("error", () => {});
      const workloadController = new AbortController();
      cleanup = () => {
        workloadController.abort();
        client.disconnect();
      };

      await waitClientReady(client, 30_000);
      assert.strictEqual(client.options.maintNotifications, "disabled");

      await client.set(KEY, "before");
      assert.strictEqual(await client.get(KEY), "before");

      const workload = TestCommandRunner.setGetUntilAbortSignal(
        client,
        KEY,
        undefined,
        workloadController
      );
      let reconnects = 0;
      client.on("reconnecting", () => reconnects++);

      // Set before the action, so afterEach restores even if the action's
      // response is lost.
      pendingRestoreAction = failureCase.createRestoreAction?.(bdbId) ?? null;
      await runAction(failureCase.createAction(bdbId));
      if (pendingRestoreAction) {
        await runAction(pendingRestoreAction);
        pendingRestoreAction = null;
      }

      // Every command issued during the fault settles before the recovery
      // check writes the same key.
      workload.controller.abort();
      const { succeeded, failures } = await workload.result;
      console.log(
        `    workload: ${succeeded} succeeded, ${reconnects} reconnects, failures: ${
          failures.size ? JSON.stringify(Object.fromEntries(failures)) : "none"
        }`
      );
      assert.isAbove(
        failures.size,
        0,
        "Some commands should fail during the connection failure"
      );

      // The same client serves regular data operations again.
      await waitForAssertion(
        async () => {
          await client.set(KEY, "after");
          assert.strictEqual(await client.get(KEY), "after");
        },
        RECOVERY_TIMEOUT_MS,
        500
      );

      // Without a reconnect the fault never reached this client's
      // connection, and the run proved nothing.
      assert.isAbove(
        reconnects,
        0,
        "The client should reconnect after the connection failure"
      );
    });
  }
});
