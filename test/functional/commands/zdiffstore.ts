import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zdiffstore (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("stores the difference and returns its cardinality", async () => {
      const key = `zdiffstore:${Date.now()}`;
      const s1 = `${key}:s1`;
      const s2 = `${key}:s2`;
      const out = `${key}:out`;
      await redis.zadd(s1, 1, "a", 2, "b", 3, "c");
      await redis.zadd(s2, 1, "a");

      expect(await redis.zdiffstore(out, 2, s1, s2)).to.equal(2);
      expect(await redis.zrange(out, 0, "-1")).to.eql(["b", "c"]);
    });
  });
}
