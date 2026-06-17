import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hmget (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing field", async () => {
      const key = `hmget:${Date.now()}`;

      expect(await redis.hmget(key, "field")).to.eql([null]);
    });

    it("returns values and null for mixed fields", async () => {
      const key = `hmget:${Date.now()}`;
      await redis.hset(key, "field1", "value1", "field2", "value2");

      expect(await redis.hmget(key, "field1", "field2", "missing")).to.eql([
        "value1",
        "value2",
        null,
      ]);
    });
  });
}
