import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zpopmin (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("pops the member with the lowest score", async () => {
      const key = `zpopmin:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      expect(await redis.zpopmin(key)).to.eql(["a", "1"]);
    });
  });
}
