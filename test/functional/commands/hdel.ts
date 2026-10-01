import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hdel (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the field does not exist", async () => {
      const key = `hdel:${Date.now()}`;

      expect(await redis.hdel(key, "field")).to.equal(0);
    });

    it("returns the number of removed fields", async () => {
      const key = `hdel:${Date.now()}`;
      await redis.hset(key, "field1", "value1", "field2", "value2", "field3", "value3");

      expect(await redis.hdel(key, "field1", "field2")).to.equal(2);
    });
  });
}
