import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrevrangebylex (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns members within the reversed lexicographical range", async () => {
      const key = `zrevrangebylex:${Date.now()}`;
      await redis.zadd(key, 0, "a", 0, "b", 0, "c");

      expect(await redis.zrevrangebylex(key, "+", "-")).to.eql(["c", "b", "a"]);
      expect(await redis.zrevrangebylex(key, "[b", "[a")).to.eql(["b", "a"]);
    });
  });
}
