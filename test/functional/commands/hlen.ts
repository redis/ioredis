import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hlen (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing key", async () => {
      const key = `hlen:${Date.now()}`;

      expect(await redis.hlen(key)).to.equal(0);
    });

    it("returns the number of fields", async () => {
      const key = `hlen:${Date.now()}`;
      await redis.hset(key, "field1", "value1", "field2", "value2", "field3", "value3");

      expect(await redis.hlen(key)).to.equal(3);
    });
  });
}
