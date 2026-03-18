import type { RedisConnectionConfig, TestConfig } from "../utils/test.util";
import {
  CHANNELS,
  createClusterTestClient,
  getConfig,
  wait,
} from "../utils/test.util";
import {
  type ActionRequest,
  FaultInjectorClient,
} from "../utils/fault-injector";
import { TestCommandRunner } from "../utils/command-runner";
import { MessageTracker } from "../utils/message-tracker";
import { assert } from "chai";

const CLUSTER_INDEX = 0;
const DEFAULT_RECOVERY_WAIT_MS = 2_000;
const POST_RECOVERY_PUBLISH_DURATION_MS = 10_000;

describe("Sharded Pub/Sub E2E - Failure Recovery Single Subscriber", () => {
  let faultInjectorClient: FaultInjectorClient;
  let config: TestConfig;
  let currentDatabaseConfig: RedisConnectionConfig | null = null;
  let cleanup: (() => Promise<void>) | null = null;

  const failureCases: Array<{
    name: string;
    createAction: (bdbId: number) => ActionRequest;
  }> = [
    {
      name: "should resume publishing and receiving after failover",
      createAction: (bdbId) => ({
        type: "failover",
        parameters: {
          bdb_id: bdbId.toString(),
          cluster_index: CLUSTER_INDEX,
        },
      }),
    },
    {
      name: "should resume publishing and receiving after rebooting a cluster node",
      createAction: () => ({
        type: "node_failure",
        parameters: {
          cluster_index: CLUSTER_INDEX,
          node_id: 1,
          method: "reboot",
        },
      }),
    },
    {
      name: "should resume publishing and receiving after restarting the database proxy",
      createAction: (bdbId) => ({
        type: "proxy_failure",
        parameters: {
          bdb_id: bdbId.toString(),
          cluster_index: CLUSTER_INDEX,
          action: "restart",
        },
      }),
    },
    {
      name: "should resume publishing and receiving after a shard failure",
      createAction: (bdbId) => ({
        type: "shard_failure",
        parameters: {
          bdb_id: bdbId.toString(),
          cluster_index: CLUSTER_INDEX,
        },
      }),
    },
  ];

  const setup = async (channels = CHANNELS) => {
    const messageTracker = new MessageTracker(channels);
    const subscriber = createClusterTestClient(config.clientConfig, {
      shardedSubscribers: true,
    });
    const publisher = createClusterTestClient(config.clientConfig);

    cleanup = async () => {
      await Promise.allSettled([subscriber.quit(), publisher.quit()]);
    };

    return { subscriber, publisher, messageTracker };
  };

  const cleanupClients = async () => {
    if (!cleanup) {
      return;
    }

    try {
      await cleanup();
    } finally {
      cleanup = null;
    }
  };

  before(() => {
    config = getConfig();
    faultInjectorClient = new FaultInjectorClient(config.faultInjectorUrl);
  });

  beforeEach(async function () {
    this.timeout(120_000);

    currentDatabaseConfig = await faultInjectorClient.createClusterTestDatabase(
      "failure-recovery-single",
    );
    config = {
      ...config,
      clientConfig: currentDatabaseConfig,
    };
  });

  afterEach(async function () {
    this.timeout(120_000);

    try {
      await cleanupClients();
    } finally {
      if (!currentDatabaseConfig) {
        return;
      }

      try {
        await faultInjectorClient.deleteDatabaseWithRetry(
          currentDatabaseConfig.bdbId,
        );
      } finally {
        currentDatabaseConfig = null;
      }
    }
  });

  for (const failureCase of failureCases) {
    it(failureCase.name, async function () {
      this.timeout(180_000);

      if (!currentDatabaseConfig) {
        throw new Error("Current database config was not initialized");
      }

      const { subscriber, publisher, messageTracker } = await setup();

      for (const channel of CHANNELS) {
        await subscriber.ssubscribe(channel);
      }

      subscriber.on("smessage", (channelName) => {
        messageTracker.incrementReceived(channelName);
      });

      const { controller: publishAbort, result: publishResult } =
        TestCommandRunner.publishMessagesUntilAbortSignal(
          publisher,
          CHANNELS,
          messageTracker,
        );

      const { action_id } = await faultInjectorClient.triggerAction(
        failureCase.createAction(currentDatabaseConfig.bdbId),
      );

      await faultInjectorClient.waitForAction(action_id, {
        maxWaitTimeMs: 120_000,
      });

      publishAbort.abort();
      await publishResult;

      const sentDuringFailure = CHANNELS.reduce(
        (sum, channel) =>
          sum + messageTracker.getChannelStatsOrThrow(channel).sent,
        0,
      );
      const receivedDuringFailure = CHANNELS.reduce(
        (sum, channel) =>
          sum + messageTracker.getChannelStatsOrThrow(channel).received,
        0,
      );

      assert.ok(
        sentDuringFailure > 0,
        "Expected messages to be published during failure",
      );
      assert.ok(
        receivedDuringFailure > 0,
        "Expected messages to be received during failure",
      );

      for (const channel of CHANNELS) {
        const { received } = messageTracker.getChannelStatsOrThrow(channel);

        assert.ok(
          received > 0,
          `Channel ${channel} should have received messages during failure`,
        );
      }

      await wait(DEFAULT_RECOVERY_WAIT_MS);

      messageTracker.reset();

      const {
        controller: postRecoveryController,
        result: postRecoveryResult,
      } = TestCommandRunner.publishMessagesUntilAbortSignal(
        publisher,
        CHANNELS,
        messageTracker,
      );

      await wait(POST_RECOVERY_PUBLISH_DURATION_MS);
      postRecoveryController.abort();
      await postRecoveryResult;

      for (const channel of CHANNELS) {
        const { sent, received } = messageTracker.getChannelStatsOrThrow(channel);

        assert.ok(sent > 0, `Channel ${channel} should have sent messages`);
        assert.ok(
          received > 0,
          `Channel ${channel} should have received messages`,
        );
        assert.strictEqual(
          received,
          sent,
          `Channel ${channel} received (${received}) should equal sent (${sent}) after recovery`,
        );
      }
    });
  }
});
