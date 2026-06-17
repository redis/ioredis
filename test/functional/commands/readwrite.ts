import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

// READWRITE only succeeds against a cluster node. Reuse the docker cluster from
// test/cluster (master node on port 3000); skip when it is unavailable.
const clusterNode = { host: "127.0.0.1", port: 3000 };

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
  describe(`readwrite (${name})`, function () {
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

    it("returns OK", async () => {
      expect(await redis.readwrite()).to.equal("OK");
    });
  });
}
