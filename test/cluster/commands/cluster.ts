import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";
import { toRecord } from "../../helpers/util";

// Master node of the docker cluster from test/cluster (ports 3000-3005).
const clusterNode = { host: "127.0.0.1", port: 3000 };

const nodeIdPattern = /^[0-9a-f]{40}$/;

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

for (const { name, opts } of RESP_CONFIGS) {
  describe(`cluster (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (!(await isClusterAvailable())) {
        this.skip();
      }
    });

    beforeEach(() => {
      redis = new Redis({ ...clusterNode, ...opts });
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("INFO returns the cluster information string", async () => {
      const info = await redis.cluster("INFO");

      expect(info).to.include("cluster_state:ok");
      expect(info).to.include("cluster_slots_assigned:16384");
    });

    it("MYID returns the node id", async () => {
      expect(await redis.cluster("MYID")).to.match(nodeIdPattern);
    });

    it("MYSHARDID returns the shard id", async () => {
      expect(await redis.cluster("MYSHARDID")).to.match(nodeIdPattern);
    });

    it("KEYSLOT returns the slot for a key", async () => {
      expect(await redis.cluster("KEYSLOT", "key")).to.equal(12539);
    });

    it("COUNTKEYSINSLOT returns the number of keys in a slot", async () => {
      const count = await redis.cluster("COUNTKEYSINSLOT", 0);

      expect(count).to.be.a("number");
      expect(count).to.be.at.least(0);
    });

    it("GETKEYSINSLOT returns key names", async () => {
      expect(await redis.cluster("GETKEYSINSLOT", 0, 10)).to.be.an("array");
    });

    it("LINKS returns an entry per peer link", async () => {
      const links = (await redis.cluster("LINKS")) as unknown[];

      expect(links).to.not.be.empty;

      const record = Array.isArray(links[0])
        ? toRecord(links[0] as unknown[])
        : (links[0] as Record<string, unknown>);
      const actual = {
        isArray: Array.isArray(links[0]),
        node: record.node,
        direction: record.direction,
      };
      const expected: Record<ReplyMapping, boolean> = {
        legacy: true,
        resp3: false,
      };

      expect(actual.isArray).to.equal(expected[opts.replyMapping]);
      expect(actual.node).to.match(nodeIdPattern);
      expect(["to", "from"]).to.include(actual.direction);
    });

    it("BUMPEPOCH returns the epoch status", async () => {
      expect(await redis.cluster("BUMPEPOCH")).to.match(/^(BUMPED|STILL) \d+$/);
    });

    it("COUNT-FAILURE-REPORTS returns the report count", async () => {
      const nodeId = await redis.cluster("MYID");

      expect(await redis.cluster("COUNT-FAILURE-REPORTS", nodeId)).to.equal(0);
    });
  });
}
