import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zintercard (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the cardinality of the intersection", async () => {
      const key = `zintercard:${Date.now()}`;
      const s1 = `${key}:s1`;
      const s2 = `${key}:s2`;
      await redis.zadd(s1, 1, "a", 2, "b", 3, "c");
      await redis.zadd(s2, 1, "a", 2, "b");

      expect(await redis.zintercard(2, s1, s2)).to.equal(2);
    });
  });
}
