import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hgetall (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty object for a missing key", async () => {
      const key = `hgetall:${Date.now()}`;

      expect(await redis.hgetall(key)).to.eql({});
    });

    it("returns all fields and values keyed by field name", async () => {
      const key = `hgetall:${Date.now()}`;
      await redis.hset(key, "field", "value");

      expect(await redis.hgetall(key)).to.eql({ field: "value" });
    });
  });
}
