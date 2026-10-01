import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hexists (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the field does not exist", async () => {
      const key = `hexists:${Date.now()}`;

      expect(await redis.hexists(key, "field")).to.equal(0);
    });

    it("returns 1 when the field exists", async () => {
      const key = `hexists:${Date.now()}`;
      await redis.hset(key, "field", "value");

      expect(await redis.hexists(key, "field")).to.equal(1);
    });
  });
}
