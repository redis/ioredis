import type { TestConfig } from "./utils/test.util";
import {
  createClusterTestClient,
  getConfig,
  wait,
  waitClientReady,
} from "./utils/test.util";

import { FaultInjectorClient } from "./utils/fault-injector";
import { TestCommandRunner } from "./utils/command-runner";
import { CHANNELS, CHANNELS_BY_SLOT } from "./utils/test.util";
import { MessageTracker } from "./utils/message-tracker";
import { Cluster } from "../../lib";
import { assert } from "chai";

describe("Sharded Pub/Sub E2E", () => {
  let subscriber: Cluster;
  let publisher: Cluster;
  let faultInjectorClient: FaultInjectorClient;
  let config: TestConfig;
  let messageTracker: MessageTracker;

  before(() => {
    config = getConfig();

    faultInjectorClient = new FaultInjectorClient(config.faultInjectorUrl);
  });

  beforeEach(async () => {
    messageTracker = new MessageTracker(CHANNELS);
    subscriber = createClusterTestClient(config.clientConfig, {
      shardedSubscribers: true,
    });
    publisher = createClusterTestClient(config.clientConfig, {
      shardedSubscribers: true,
    });
    await Promise.all([
      waitClientReady(subscriber),
      waitClientReady(publisher),
    ]);
  });

  afterEach(async () => {
    await Promise.all([subscriber.quit(), publisher.quit()]);
  });

  it("should receive messages published to multiple channels", async () => {
    for (const channel of CHANNELS) {
      await subscriber.ssubscribe(channel);
    }

    subscriber.on("smessage", (channelName, _) => {
      messageTracker.incrementReceived(channelName);
    });

    const { controller, result } =
      TestCommandRunner.publishMessagesUntilAbortSignal(
        publisher,
        CHANNELS,
        messageTracker
      );

    // Wait for 10 seconds, while publishing messages
    await wait(10_000);
    controller.abort();
    await result;

    for (const channel of CHANNELS) {
      assert.strictEqual(
        messageTracker.getChannelStats(channel)?.received,
        messageTracker.getChannelStats(channel)?.sent
      );
    }
  });

  it("should resume publishing and receiving after failover", async () => {
    for (const channel of CHANNELS) {
      await subscriber.ssubscribe(channel);
    }

    subscriber.on("smessage", (channelName, _) => {
      messageTracker.incrementReceived(channelName);
    });

    // Start publishing messages
    const { controller: publishAbort, result: publishResult } =
      TestCommandRunner.publishMessagesUntilAbortSignal(
        publisher,
        CHANNELS,
        messageTracker
      );

    // Trigger failover during publishing
    const { action_id: failoverActionId } =
      await faultInjectorClient.triggerAction({
        type: "failover",
        parameters: {
          bdb_id: config.clientConfig.bdbId.toString(),
          cluster_index: 0,
        },
      });

    // Wait for failover to complete
    await faultInjectorClient.waitForAction(failoverActionId);

    publishAbort.abort();
    await publishResult;

    for (const channel of CHANNELS) {
      const sent = messageTracker.getChannelStats(channel)!.sent;
      const received = messageTracker.getChannelStats(channel)!.received;

      assert.ok(
        received <= sent,
        `Channel ${channel}: received (${received}) should be <= sent (${sent})`
      );
    }

    messageTracker.reset();

    const { controller: afterFailoverController, result: afterFailoverResult } =
      TestCommandRunner.publishMessagesUntilAbortSignal(
        publisher,
        CHANNELS,
        messageTracker
      );

    await wait(10_000);
    afterFailoverController.abort();
    await afterFailoverResult;

    for (const channel of CHANNELS) {
      const sent = messageTracker.getChannelStats(channel)!.sent;
      const received = messageTracker.getChannelStats(channel)!.received;
      assert.ok(sent > 0, `Channel ${channel} should have sent messages`);
      assert.ok(
        received > 0,
        `Channel ${channel} should have received messages`
      );
      assert.strictEqual(
        messageTracker.getChannelStats(channel)!.received,
        messageTracker.getChannelStats(channel)!.sent,
        `Channel ${channel} received (${received}) should equal sent (${sent}) once resumed after failover`
      );
    }
  });

  it("should NOT receive messages after sunsubscribe", async () => {
    for (const channel of CHANNELS) {
      await subscriber.ssubscribe(channel);
    }

    subscriber.on("smessage", (channelName, _) => {
      messageTracker.incrementReceived(channelName);
    });

    const { controller, result } =
      TestCommandRunner.publishMessagesUntilAbortSignal(
        publisher,
        CHANNELS,
        messageTracker
      );

    // Wait for 5 seconds, while publishing messages
    await wait(5_000);
    controller.abort();
    await result;

    for (const channel of CHANNELS) {
      assert.strictEqual(
        messageTracker.getChannelStats(channel)?.received,
        messageTracker.getChannelStats(channel)?.sent
      );
    }

    // Reset message tracker
    messageTracker.reset();

    const unsubscribeChannels = [
      CHANNELS_BY_SLOT["3656"],
      CHANNELS_BY_SLOT["7071"],
      CHANNELS_BY_SLOT["14479"],
    ];

    for (const channel of unsubscribeChannels) {
      await subscriber.sunsubscribe(channel);
    }

    const {
      controller: afterUnsubscribeController,
      result: afterUnsubscribeResult,
    } = TestCommandRunner.publishMessagesUntilAbortSignal(
      publisher,
      CHANNELS,
      messageTracker
    );

    // Wait for 5 seconds, while publishing messages
    await wait(5_000);
    afterUnsubscribeController.abort();
    await afterUnsubscribeResult;

    for (const channel of unsubscribeChannels) {
      assert.strictEqual(
        messageTracker.getChannelStats(channel)?.received,
        0,
        `Channel ${channel} should not have received messages after unsubscribe`
      );
    }

    // All other channels should have received messages
    const stillSubscribedChannels = CHANNELS.filter(
      (channel) => !unsubscribeChannels.includes(channel as any)
    );

    for (const channel of stillSubscribedChannels) {
      assert.ok(
        messageTracker.getChannelStats(channel)!.received > 0,
        `Channel ${channel} should have received messages`
      );
    }
  });
});
