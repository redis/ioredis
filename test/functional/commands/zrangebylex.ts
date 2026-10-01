import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrangebylex (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns members within the lexicographical range", async () => {
      const key = `zrangebylex:${Date.now()}`;
      await redis.zadd(key, 0, "a", 0, "b", 0, "c");

      expect(await redis.zrangebylex(key, "-", "+")).to.eql(["a", "b", "c"]);
      expect(await redis.zrangebylex(key, "[a", "[b")).to.eql(["a", "b"]);
    });
  });
}
