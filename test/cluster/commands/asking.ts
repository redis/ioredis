import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

// Master node of the docker cluster from test/cluster (ports 3000-3005).
// ASKING is a cluster-only command; it returns OK on any cluster-mode node.
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
  describe(`asking (${name})`, function () {
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
      expect(await redis.asking()).to.equal("OK");
    });
  });
}
