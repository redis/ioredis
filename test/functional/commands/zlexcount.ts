import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zlexcount (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("counts members within the lexicographical range", async () => {
      const key = `zlexcount:${Date.now()}`;
      await redis.zadd(key, 0, "a", 0, "b", 0, "c");

      expect(await redis.zlexcount(key, "-", "+")).to.equal(3);
      expect(await redis.zlexcount(key, "[a", "[b")).to.equal(2);
    });
  });
}
