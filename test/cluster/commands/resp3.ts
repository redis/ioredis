import { expect } from "chai";
import { Cluster } from "../../../lib";
import Redis from "../../../lib/Redis";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

// Master node of the docker cluster from test/cluster (ports 3000-3005).
const clusterNode = { host: "127.0.0.1", port: 3000 };
const startupNodes = [clusterNode];

const CASES: ReadonlyArray<{
  name: string;
  redisOptions?: { protocol: 2 | 3; replyMapping: ReplyMapping };
  expectedMapping: ReplyMapping;
}> = [
  {
    name: "default RESP3/legacy",
    expectedMapping: "legacy",
  },
  ...RESP_CONFIGS.map(({ name, opts }) => ({
    name,
    redisOptions: opts,
    expectedMapping: opts.replyMapping,
  })),
];

async function isClusterAvailable(): Promise<boolean> {
  const redis = new Redis({
    ...clusterNode,
    lazyConnect: true,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

describe("cluster:resp3 reply mapping", function () {
  before(async function () {
    if (!(await isClusterAvailable())) {
      this.skip();
    }
  });

  for (const config of CASES) {
    describe(config.name, () => {
      let cluster: Cluster;
      let key: string;

      beforeEach(async () => {
        cluster = new Cluster(
          startupNodes,
          config.redisOptions ? { redisOptions: config.redisOptions } : {}
        );
        key = `cluster:resp3:{${Date.now()}:${Math.random()}}`;
        await cluster.zadd(key, 1, "a", 2, "b");
      });

      afterEach(async () => {
        if (cluster && key) {
          await cluster.del(key).catch(() => undefined);
        }
        if (cluster) {
          cluster.disconnect();
        }
      });

      it("maps DOUBLE replies", async () => {
        const expected: Record<ReplyMapping, string | number> = {
          legacy: "1",
          resp3: 1,
        };

        expect(await cluster.zscore(key, "a")).to.eql(
          expected[config.expectedMapping]
        );
      });

      it("maps WITHSCORES pair replies", async () => {
        const expected: Record<ReplyMapping, unknown> = {
          legacy: ["a", "1", "b", "2"],
          resp3: [
            ["a", 1],
            ["b", 2],
          ],
        };

        expect(await cluster.zrange(key, 0, -1, "WITHSCORES")).to.eql(
          expected[config.expectedMapping]
        );
      });

      it("maps MAP replies", async () => {
        const expected: Record<ReplyMapping, unknown> = {
          legacy: ["maxmemory", "0"],
          resp3: { maxmemory: "0" },
        };

        expect(await cluster.config("GET", "maxmemory")).to.eql(
          expected[config.expectedMapping]
        );
      });

      it("maps BOOLEAN replies", async function () {
        if (await isRedisVersionLowerThan("8.0", clusterNode)) {
          this.skip();
        }

        const vectorKey = `${key}:vector`;
        const expectedAdded: Record<ReplyMapping, number | boolean> = {
          legacy: 1,
          resp3: true,
        };
        const expectedUpdated: Record<ReplyMapping, number | boolean> = {
          legacy: 0,
          resp3: false,
        };

        try {
          expect(
            await cluster.vadd(vectorKey, "VALUES", 3, 1, 2, 3, "one")
          ).to.eql(expectedAdded[config.expectedMapping]);
          expect(
            await cluster.vadd(vectorKey, "VALUES", 3, 1, 2, 4, "one")
          ).to.eql(expectedUpdated[config.expectedMapping]);
        } finally {
          await cluster.del(vectorKey).catch(() => undefined);
        }
      });
    });
  }

  describe("RESP3/resp3/stringNumbers", () => {
    let cluster: Cluster;
    let keys: string[] = [];

    beforeEach(async () => {
      cluster = new Cluster(startupNodes, {
        redisOptions: {
          protocol: 3,
          replyMapping: "resp3",
          stringNumbers: true,
        },
      });
      keys = [`cluster:resp3:stringNumbers:{${Date.now()}:${Math.random()}}`];
      await cluster.zadd(keys[0], 1.5, "a");
    });

    afterEach(async () => {
      if (cluster && keys.length > 0) {
        await cluster.del(...keys).catch(() => undefined);
      }
      if (cluster) {
        cluster.disconnect();
      }
    });

    it("keeps numeric replies as strings", async () => {
      const counterKey = `${keys[0]}:counter`;
      keys.push(counterKey);

      expect(await cluster.zscore(keys[0], "a")).to.equal("1.5");
      expect(await cluster.incr(counterKey)).to.equal("1");
      expect(await cluster.zrange(keys[0], 0, -1, "WITHSCORES")).to.eql([
        ["a", "1.5"],
      ]);
    });
  });

  describe("duplicate", () => {
    let cluster: Cluster;
    let duplicated: Cluster | undefined;
    let key: string;

    beforeEach(async () => {
      cluster = new Cluster(startupNodes, {
        redisOptions: { protocol: 3, replyMapping: "resp3" },
      });
      key = `cluster:resp3:duplicate:{${Date.now()}:${Math.random()}}`;
      await cluster.zadd(key, 1, "a");
    });

    afterEach(async () => {
      await cluster.del(key).catch(() => undefined);
      cluster.disconnect();
      if (duplicated) {
        duplicated.disconnect();
        duplicated = undefined;
      }
    });

    it("keeps protocol and reply mapping when overriding other redisOptions", async () => {
      duplicated = cluster.duplicate([], {
        redisOptions: { connectionName: "duplicated" },
      });

      expect(duplicated.options.redisOptions?.protocol).to.equal(3);
      expect(duplicated.options.redisOptions?.replyMapping).to.equal("resp3");
      expect(duplicated.options.redisOptions?.connectionName).to.equal(
        "duplicated"
      );
      expect(await duplicated.zscore(key, "a")).to.equal(1);
    });

    it("allows overriding reply mapping", async () => {
      duplicated = cluster.duplicate([], {
        redisOptions: { replyMapping: "legacy" },
      });

      expect(duplicated.options.redisOptions?.protocol).to.equal(3);
      expect(await duplicated.zscore(key, "a")).to.equal("1");
    });
  });
});
