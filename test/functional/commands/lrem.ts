import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lrem (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing key", async () => {
      const key = `lrem:${Date.now()}`;

      expect(await redis.lrem(key, 0, "element")).to.equal(0);
    });

    it("returns the number of removed elements", async () => {
      const key = `lrem:${Date.now()}`;
      await redis.rpush(key, "a", "b", "a", "c", "a");

      expect(await redis.lrem(key, 2, "a")).to.equal(2);
      expect(await redis.lrange(key, 0, -1)).to.eql(["b", "c", "a"]);
    });
  });
}
