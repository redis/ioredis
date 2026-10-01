import type { RedisConnectionConfig, TestConfig } from "../utils/test.util";
import {
  CHANNELS,
  createClusterTestClient,
  getConfig,
  waitClientReady,
  waitForAssertion,
} from "../utils/test.util";
import { FaultInjectorClient } from "../utils/fault-injector";
import { Cluster } from "../../../lib";
import { assert } from "chai";

const SHARDED_SUBSCRIBER_NAME = "ioredis-cluster(ssubscriber)";

describe("Sharded Pub/Sub E2E - Connection Lifecycle", () => {
  let faultInjectorClient: FaultInjectorClient;
  let config: TestConfig;
  let sharedDatabaseConfig: RedisConnectionConfig | null = null;
  let cleanup: (() => Promise<void>) | null = null;

  const setup = async (subscriberOverrides = {}) => {
    const subscriber = createClusterTestClient(config.clientConfig, {
      shardedSubscribers: true,
      ...subscriberOverrides,
    });

    cleanup = async () => {
      await Promise.allSettled([subscriber.quit()]);
    };

    return { subscriber };
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

  const getShardedSubscriberConnectionCounts = async (subscriber: Cluster) => {
    const masters = subscriber.nodes("master");

    assert.isAbove(masters.length, 0, "expected at least one master node");

    const counts = [];

    for (const node of masters) {
      const clientList = await node.client("LIST");
      const connectionCount = clientList
        .split("\n")
        .filter((line) => line.includes(`name=${SHARDED_SUBSCRIBER_NAME}`))
        .length;

      counts.push({
        connectionCount,
        host: node.options.host,
        port: node.options.port,
      });
    }

    return counts;
  };

  const assertSubscriberConnectionCountPerMaster = async (
    subscriber: Cluster,
    expectedCountPerMaster: number,
  ) => {
    const counts = await getShardedSubscriberConnectionCounts(subscriber);

    for (const { connectionCount, host, port } of counts) {
      assert.strictEqual(
        connectionCount,
        expectedCountPerMaster,
        `Expected ${expectedCountPerMaster} sharded subscriber connections on ${host}:${port}, got ${connectionCount}`,
      );
    }
  };

  before(async function () {
    this.timeout(120_000);

    config = getConfig();
    faultInjectorClient = new FaultInjectorClient(config.faultInjectorUrl);
    sharedDatabaseConfig = await faultInjectorClient.createClusterTestDatabase(
      "connection-lifecycle-shared",
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

  it("keeps sharded subscribers lazy by default until channels are subscribed", async () => {
    const { subscriber } = await setup();

    await waitClientReady(subscriber);
    await assertSubscriberConnectionCountPerMaster(subscriber, 0);

    for (const channel of CHANNELS) {
      await subscriber.ssubscribe(channel);
    }

    await waitForAssertion(() =>
      assertSubscriberConnectionCountPerMaster(subscriber, 1),
    );
  });

  it("reuses one sharded subscriber connection for multiple channels on the same shard", async () => {
    const { subscriber } = await setup();
    const channels = ["{shared-shard}one", "{shared-shard}two"];

    await waitClientReady(subscriber);

    for (const channel of channels) {
      await subscriber.ssubscribe(channel);
    }

    await waitForAssertion(async () => {
      const counts = await getShardedSubscriberConnectionCounts(subscriber);
      const totalConnectionCount = counts.reduce(
        (sum, { connectionCount }) => sum + connectionCount,
        0,
      );

      for (const { connectionCount, host, port } of counts) {
        assert.isAtMost(
          connectionCount,
          1,
          `Expected at most 1 sharded subscriber connection on ${host}:${port}, got ${connectionCount}`,
        );
      }

      assert.strictEqual(
        totalConnectionCount,
        1,
        `Expected 1 total sharded subscriber connection, got ${totalConnectionCount}`,
      );
    });
  });

  it("eagerly creates one sharded subscriber connection per master when lazyConnect is disabled", async () => {
    const { subscriber } = await setup({
      redisOptions: { lazyConnect: false },
    });

    await waitClientReady(subscriber);
    await waitForAssertion(() =>
      assertSubscriberConnectionCountPerMaster(subscriber, 1),
    );
  });
});
