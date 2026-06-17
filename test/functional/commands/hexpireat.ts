import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hexpireat (${name})`, function () {
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

    it("should handle non-existing field", async () => {
      const key = `hexpireat:${Date.now()}`;
      const expiresAt = Math.floor(Date.now() / 1000) + 60;

      const result = await redis.hexpireat(
        key,
        expiresAt,
        "NX",
        "FIELDS",
        1,
        "non_existing_field"
      );

      expect(result).to.deep.equal([-2]);
    });

    it("should handle existing field", async () => {
      const key = `hexpireat:${Date.now()}`;
      const expiresAt = Math.floor(Date.now() / 1000) + 60;

      await redis.hset(key, "field", "value");

      const result = await redis.hexpireat(
        key,
        expiresAt,
        "FIELDS",
        1,
        "field"
      );

      expect(result).to.deep.equal([1]);
    });

    it("should return 0 when condition is not met", async () => {
      const key = `hexpireat:${Date.now()}`;
      const initialExpiresAt = Math.floor(Date.now() / 1000) + 60;
      const nextExpiresAt = Math.floor(Date.now() / 1000) + 120;

      await redis.hset(key, "field", "value");
      await redis.hexpireat(key, initialExpiresAt, "FIELDS", 1, "field");

      const result = await redis.hexpireat(
        key,
        nextExpiresAt,
        "NX",
        "FIELDS",
        1,
        "field"
      );

      expect(result).to.deep.equal([0]);
    });

    it("should return 2 when expiring field with 0 unix time", async () => {
      const key = `hexpireat:${Date.now()}`;

      await redis.hset(key, "field", "value");

      const result = await redis.hexpireat(key, 0, "FIELDS", 1, "field");

      expect(result).to.deep.equal([2]);
    });

    it("should expire multiple fields", async () => {
      const key = `hexpireat:${Date.now()}`;
      const expiresAt = Math.floor(Date.now() / 1000) + 60;

      await redis.hset(key, "field", "value", "field2", "value2");

      const result = await redis.hexpireat(
        key,
        expiresAt,
        "FIELDS",
        3,
        "field",
        "field2",
        "non_existing_field"
      );

      expect(result).to.deep.equal([1, 1, -2]);
    });
  });
}
