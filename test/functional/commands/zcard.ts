import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zcard (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the number of members in the sorted set", async () => {
      const key = `zcard:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b", 3, "c");

      expect(await redis.zcard(key)).to.equal(3);
    });
  });
}
