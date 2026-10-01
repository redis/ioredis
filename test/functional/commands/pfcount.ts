import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`pfcount (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing key", async () => {
      const key = `pfcount:${Date.now()}`;

      expect(await redis.pfcount(key)).to.equal(0);
    });

    it("returns the estimated cardinality", async () => {
      const key = `pfcount:${Date.now()}`;
      await redis.pfadd(key, "a", "b", "c");

      expect(await redis.pfcount(key)).to.equal(3);
    });
  });
}
