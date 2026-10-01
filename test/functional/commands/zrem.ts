import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrem (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("removes members and returns the count removed", async () => {
      const key = `zrem:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b", 3, "c");

      expect(await redis.zrem(key, "a", "b")).to.equal(2);
      expect(await redis.zrange(key, 0, "-1")).to.eql(["c"]);
    });
  });
}
