import type { RedisConnectionConfig, TestConfig } from "../utils/test.util";
import {
  CHANNELS,
  createClusterTestClient,
  getConfig,
  wait,
  waitClientReady,
  waitForAssertion,
} from "../utils/test.util";
import {
  type ActionRequest,
  FaultInjectorClient,
} from "../utils/fault-injector";
import { TestCommandRunner } from "../utils/command-runner";
import { MessageTracker } from "../utils/message-tracker";
import { assert } from "chai";

const CLUSTER_INDEX = 0;
const POST_RECOVERY_PUBLISH_DURATION_MS = 10_000;
const MIN_POST_RECOVERY_DELIVERY_RATIO = 0.9;

describe("Sharded Pub/Sub E2E - Failure Recovery Multiple Subscribers", () => {
  let faultInjectorClient: FaultInjectorClient;
  let config: TestConfig;
  let currentDatabaseConfig: RedisConnectionConfig | null = null;
  let subscriber1: ReturnType<typeof createClusterTestClient>;
  let subscriber2: ReturnType<typeof createClusterTestClient>;
  let publisher: ReturnType<typeof createClusterTestClient>;
  let messageTracker1: MessageTracker;
  let messageTracker2: MessageTracker;

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
      name: "should resume publishing and receiving for both subscribers after rebooting a cluster node",
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
      name: "should resume publishing and receiving for both subscribers after restarting the database proxy",
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
      name: "should resume publishing and receiving for both subscribers after a shard failure",
      createAction: (bdbId) => ({
        type: "shard_failure",
        parameters: {
          bdb_id: bdbId.toString(),
          cluster_index: CLUSTER_INDEX,
        },
      }),
    },
  ];

  const setupClients = async () => {
    messageTracker1 = new MessageTracker(CHANNELS);
    messageTracker2 = new MessageTracker(CHANNELS);
    subscriber1 = createClusterTestClient(config.clientConfig, {
      shardedSubscribers: true,
    });
    subscriber2 = createClusterTestClient(config.clientConfig, {
      shardedSubscribers: true,
    });
    publisher = createClusterTestClient(config.clientConfig);

    await Promise.all([
      waitClientReady(subscriber1),
      waitClientReady(subscriber2),
      waitClientReady(publisher),
    ]);
  };

  const cleanupClients = async () => {
    await Promise.allSettled([
      subscriber1?.quit(),
      subscriber2?.quit(),
      publisher?.quit(),
    ]);
  };

  const sumSentMessages = (
    messageTracker: MessageTracker,
    channels = CHANNELS,
  ) =>
    channels.reduce(
      (sum, channel) =>
        sum + messageTracker.getChannelStatsOrThrow(channel).sent,
      0,
    );

  const sumReceivedMessages = (
    messageTracker: MessageTracker,
    channels = CHANNELS,
  ) =>
    channels.reduce(
      (sum, channel) =>
        sum + messageTracker.getChannelStatsOrThrow(channel).received,
      0,
    );

  const assertAllChannelsReceived = (
    messageTracker: MessageTracker,
    channels = CHANNELS,
  ) => {
    for (const channel of channels) {
      const { received } = messageTracker.getChannelStatsOrThrow(channel);

      assert.ok(
        received > 0,
        `Channel ${channel} should have received messages during failure`,
      );
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
    await setupClients();
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

      for (const channel of CHANNELS) {
        await subscriber1.ssubscribe(channel);
        await subscriber2.ssubscribe(channel);
      }

      subscriber1.on("smessage", (channelName) => {
        messageTracker1.incrementReceived(channelName);
      });

      subscriber2.on("smessage", (channelName) => {
        messageTracker2.incrementReceived(channelName);
      });

      const { controller: publishAbort, result: publishResult } =
        TestCommandRunner.publishMessagesUntilAbortSignal(
          publisher,
          CHANNELS,
          messageTracker1,
        );

      const { action_id } = await faultInjectorClient.triggerAction(
        failureCase.createAction(currentDatabaseConfig.bdbId),
      );

      await faultInjectorClient.waitForAction(action_id, {
        maxWaitTimeMs: 120_000,
      });

      publishAbort.abort();
      await publishResult;

      assert.ok(
        sumSentMessages(messageTracker1) > 0,
        "Expected messages to be published during failure",
      );
      assert.ok(
        sumReceivedMessages(messageTracker1) +
          sumReceivedMessages(messageTracker2) >
          0,
        "Expected messages to be received during failure",
      );
      assertAllChannelsReceived(messageTracker1);
      assertAllChannelsReceived(messageTracker2);

      messageTracker1.reset();
      messageTracker2.reset();

      const {
        controller: recoveryProbeController,
        result: recoveryProbeResult,
      } = TestCommandRunner.publishMessagesUntilAbortSignal(
        publisher,
        CHANNELS,
        messageTracker1,
      );

      await waitForAssertion(() => {
        for (const channel of CHANNELS) {
          const { received: received1 } = messageTracker1.getChannelStatsOrThrow(
            channel,
          );
          const { received: received2 } = messageTracker2.getChannelStatsOrThrow(
            channel,
          );

          assert.ok(
            received1 > 0,
            `Channel ${channel} should resume receiving messages by subscriber 1 after recovery`,
          );
          assert.ok(
            received2 > 0,
            `Channel ${channel} should resume receiving messages by subscriber 2 after recovery`,
          );
        }
      }, 45_000);

      recoveryProbeController.abort();
      await recoveryProbeResult;

      // Start the final verification window with fresh counters after recovery.
      messageTracker1.reset();
      messageTracker2.reset();

      const { controller: postRecoveryController, result: postRecoveryResult } =
        TestCommandRunner.publishMessagesUntilAbortSignal(
          publisher,
          CHANNELS,
          messageTracker1,
        );

      await wait(POST_RECOVERY_PUBLISH_DURATION_MS);
      postRecoveryController.abort();
      await postRecoveryResult;

      for (const channel of CHANNELS) {
        const { sent, received: received1 } =
          messageTracker1.getChannelStatsOrThrow(channel);
        const { received: received2 } =
          messageTracker2.getChannelStatsOrThrow(channel);
        const deliveryRatio1 = received1 / sent;
        const deliveryRatio2 = received2 / sent;

        assert.ok(sent > 0, `Channel ${channel} should have sent messages`);
        assert.ok(
          received1 > 0,
          `Channel ${channel} should have received messages by subscriber 1`,
        );
        assert.ok(
          received2 > 0,
          `Channel ${channel} should have received messages by subscriber 2`,
        );
        assert.ok(
          deliveryRatio1 >= MIN_POST_RECOVERY_DELIVERY_RATIO,
          `Channel ${channel} subscriber 1 received ${received1} of ${sent} messages after recovery (${(
            deliveryRatio1 * 100
          ).toFixed(1)}%)`,
        );
        assert.ok(
          deliveryRatio2 >= MIN_POST_RECOVERY_DELIVERY_RATIO,
          `Channel ${channel} subscriber 2 received ${received2} of ${sent} messages after recovery (${(
            deliveryRatio2 * 100
          ).toFixed(1)}%)`,
        );
      }
    });
  }
});
