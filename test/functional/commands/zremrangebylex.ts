import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zremrangebylex (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("removes members within the lexicographical range", async () => {
      const key = `zremrangebylex:${Date.now()}`;
      await redis.zadd(key, 0, "a", 0, "b", 0, "c");

      expect(await redis.zremrangebylex(key, "[a", "[b")).to.equal(2);
      expect(await redis.zrange(key, 0, "-1")).to.eql(["c"]);
    });
  });
}
