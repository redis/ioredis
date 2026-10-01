import type { RedisConnectionConfig, TestConfig } from "../utils/test.util";
import {
  CHANNELS,
  CHANNELS_BY_SLOT,
  createClusterTestClient,
  getConfig,
  wait,
  waitForAssertion,
} from "../utils/test.util";
import { FaultInjectorClient } from "../utils/fault-injector";
import { TestCommandRunner } from "../utils/command-runner";
import { MessageTracker } from "../utils/message-tracker";
import { assert } from "chai";

describe("Sharded Pub/Sub E2E - Basic", () => {
  let faultInjectorClient: FaultInjectorClient;
  let config: TestConfig;
  let sharedDatabaseConfig: RedisConnectionConfig | null = null;
  let cleanup: (() => Promise<void>) | null = null;

  const setup = async (
    subscriberOverrides = {},
    publisherOverrides = {},
    channels = CHANNELS,
  ) => {
    const messageTracker = new MessageTracker(channels);
    const subscriber = createClusterTestClient(config.clientConfig, {
      shardedSubscribers: true,
      ...subscriberOverrides,
    });
    const publisher = createClusterTestClient(
      config.clientConfig,
      publisherOverrides,
    );

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

  before(async function () {
    this.timeout(120_000);

    config = getConfig();
    faultInjectorClient = new FaultInjectorClient(config.faultInjectorUrl);
    sharedDatabaseConfig = await faultInjectorClient.createClusterTestDatabase(
      "basic-shared",
    );
  });

  beforeEach(() => {
    if (!sharedDatabaseConfig) {
      throw new Error("Shared database config was not initialized");
    }

    config = {
      ...config,
      clientConfig: sharedDatabaseConfig,
    };
  });

  afterEach(async () => {
    await cleanupClients();
  });

  after(async function () {
    this.timeout(120_000);

    if (!sharedDatabaseConfig) {
      return;
    }

    await faultInjectorClient.deleteDatabaseWithRetry(sharedDatabaseConfig.bdbId);
    sharedDatabaseConfig = null;
  });

  it("should receive messages published to multiple channels", async () => {
    const { subscriber, publisher, messageTracker } = await setup();

    for (const channel of CHANNELS) {
      await subscriber.ssubscribe(channel);
    }

    subscriber.on("smessage", (channelName) => {
      messageTracker.incrementReceived(channelName);
    });

    const { controller, result } =
      TestCommandRunner.publishMessagesUntilAbortSignal(
        publisher,
        CHANNELS,
        messageTracker,
      );

    await wait(10_000);
    controller.abort();
    await result;

    for (const channel of CHANNELS) {
      const { sent, received } = messageTracker.getChannelStatsOrThrow(channel);

      assert.isAbove(sent, 0, `Channel ${channel} should have sent messages`);
      assert.isAbove(
        received,
        0,
        `Channel ${channel} should have received messages`,
      );
      assert.strictEqual(received, sent);
    }
  });

  it("should deliver messages to multiple sharded subscribers", async () => {
    const messageTracker1 = new MessageTracker(CHANNELS);
    const messageTracker2 = new MessageTracker(CHANNELS);
    const subscriber1 = createClusterTestClient(config.clientConfig, {
      shardedSubscribers: true,
    });
    const subscriber2 = createClusterTestClient(config.clientConfig, {
      shardedSubscribers: true,
    });
    const publisher = createClusterTestClient(config.clientConfig);

    cleanup = async () => {
      await Promise.allSettled([
        subscriber1.quit(),
        subscriber2.quit(),
        publisher.quit(),
      ]);
    };

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

    const { controller, result } =
      TestCommandRunner.publishMessagesUntilAbortSignal(
        publisher,
        CHANNELS,
        messageTracker1,
      );

    await wait(10_000);
    controller.abort();
    await result;

    for (const channel of CHANNELS) {
      const {
        sent,
        received: received1,
      } = messageTracker1.getChannelStatsOrThrow(channel);
      const { received: received2 } =
        messageTracker2.getChannelStatsOrThrow(channel);

      assert.isAbove(sent, 0, `Channel ${channel} should have sent messages`);
      assert.isAbove(
        received1,
        0,
        `Channel ${channel} should have received messages by subscriber 1`,
      );
      assert.isAbove(
        received2,
        0,
        `Channel ${channel} should have received messages by subscriber 2`,
      );
      assert.strictEqual(
        received1,
        sent,
      );
      assert.strictEqual(
        received2,
        sent,
      );
    }
  });

  it("delivers each message once when ssubscribe is called multiple times for the same channel", async () => {
    const channel = "{same-channel}events";
    const { subscriber, publisher, messageTracker } = await setup({}, {}, [
      channel,
    ]);
    const publishedMessages = ["message-1", "message-2", "message-3"];

    subscriber.on("smessage", (channelName) => {
      messageTracker.incrementReceived(channelName);
    });

    await subscriber.ssubscribe(channel);
    await subscriber.ssubscribe(channel);

    for (const message of publishedMessages) {
      messageTracker.incrementSent(channel);
      await publisher.spublish(channel, message);
    }

    await waitForAssertion(async () => {
      const { sent, received } = messageTracker.getChannelStatsOrThrow(channel);

      assert.isAbove(sent, 0, `Expected ${channel} to have sent messages`);
      assert.isAbove(received, 0, `Expected ${channel} to have received messages`);
      assert.strictEqual(
        received,
        sent,
        `Expected ${channel} to have the same number of received and sent messages`,
      );
    });
  });

  it("should NOT receive messages after sunsubscribe", async () => {
    const { subscriber, publisher, messageTracker } = await setup();
    const unsubscribeChannels = [
      CHANNELS_BY_SLOT["1000"],
      CHANNELS_BY_SLOT["8000"],
      CHANNELS_BY_SLOT["16000"],
    ];

    for (const channel of CHANNELS) {
      await subscriber.ssubscribe(channel);
    }

    subscriber.on("smessage", (channelName) => {
      messageTracker.incrementReceived(channelName);
    });

    const { controller, result } =
      TestCommandRunner.publishMessagesUntilAbortSignal(
        publisher,
        CHANNELS,
        messageTracker,
      );

    await wait(5_000);
    controller.abort();
    await result;
    for (const channel of CHANNELS) {
      const { sent, received } = messageTracker.getChannelStatsOrThrow(channel);

      assert.isAbove(sent, 0, `Channel ${channel} should have sent messages`);
      assert.isAbove(
        received,
        0,
        `Channel ${channel} should have received messages`,
      );
      assert.strictEqual(received, sent);
    }

    messageTracker.reset();

    for (const channel of unsubscribeChannels) {
      await subscriber.sunsubscribe(channel);
    }

    const {
      controller: afterUnsubscribeController,
      result: afterUnsubscribeResult,
    } = TestCommandRunner.publishMessagesUntilAbortSignal(
      publisher,
      CHANNELS,
      messageTracker,
    );

    await wait(5_000);
    afterUnsubscribeController.abort();
    await afterUnsubscribeResult;

    for (const channel of unsubscribeChannels) {
      const { received } = messageTracker.getChannelStatsOrThrow(channel);

      assert.strictEqual(
        received,
        0,
        `Channel ${channel} should not have received messages after unsubscribe`,
      );
    }

    const stillSubscribedChannels = CHANNELS.filter(
      (channel) => !unsubscribeChannels.includes(channel as any),
    );

    for (const channel of stillSubscribedChannels) {
      const { received } = messageTracker.getChannelStatsOrThrow(channel);

      assert.ok(
        received > 0,
        `Channel ${channel} should have received messages`,
      );
    }
  });
});
