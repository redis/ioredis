import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`pfadd (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 1 when the cardinality changes", async () => {
      const key = `pfadd:${Date.now()}`;

      expect(await redis.pfadd(key, "1")).to.equal(1);
    });

    it("returns 0 when no new elements are added", async () => {
      const key = `pfadd:${Date.now()}`;
      await redis.pfadd(key, "1");

      expect(await redis.pfadd(key, "1")).to.equal(0);
    });
  });
}
