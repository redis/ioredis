import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hexpire (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("7.4")) {
        this.skip();
      }
    });

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 1 when an expiry is set on an existing field", async () => {
      const key = `hexpire:${Date.now()}`;
      await redis.hset(key, "field", "value");

      expect(await redis.hexpire(key, 60, "FIELDS", 1, "field")).to.deep.equal([
        1,
      ]);
    });

    it("returns values for multiple fields", async () => {
      const key = `hexpire:${Date.now()}`;
      await redis.hset(key, "field", "value", "field2", "value2");

      expect(
        await redis.hexpire(
          key,
          60,
          "FIELDS",
          3,
          "field",
          "field2",
          "non_existing_field"
        )
      ).to.deep.equal([1, 1, -2]);
    });
  });
}
