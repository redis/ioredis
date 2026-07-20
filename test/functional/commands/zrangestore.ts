import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrangestore (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("stores the range and returns its cardinality", async () => {
      const key = `zrangestore:${Date.now()}`;
      const src = `${key}:src`;
      const dst = `${key}:dst`;
      await redis.zadd(src, 1, "a", 2, "b", 3, "c");

      expect(await redis.zrangestore(dst, src, 0, 1)).to.equal(2);
      expect(await redis.zrange(dst, 0, "-1")).to.eql(["a", "b"]);
    });
  });
}
