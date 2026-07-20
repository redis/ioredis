import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hget (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing field", async () => {
      const key = `hget:${Date.now()}`;

      expect(await redis.hget(key, "field")).to.equal(null);
    });

    it("returns the field value", async () => {
      const key = `hget:${Date.now()}`;
      await redis.hset(key, "field", "value");

      expect(await redis.hget(key, "field")).to.equal("value");
    });
  });
}
