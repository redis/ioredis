import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hpexpireat (${name})`, function () {
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
      const key = `hpexpireat:${Date.now()}`;
      const expiresAt = Date.now() + 60_000;

      const result = await redis.hpexpireat(
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
      const key = `hpexpireat:${Date.now()}`;
      const expiresAt = Date.now() + 60_000;

      await redis.hset(key, "field", "value");

      const result = await redis.hpexpireat(
        key,
        expiresAt,
        "FIELDS",
        1,
        "field"
      );

      expect(result).to.deep.equal([1]);
    });

    it("should return 0 when condition is not met", async () => {
      const key = `hpexpireat:${Date.now()}`;
      const initialExpiresAt = Date.now() + 60_000;
      const nextExpiresAt = Date.now() + 120_000;

      await redis.hset(key, "field", "value");
      await redis.hpexpireat(key, initialExpiresAt, "FIELDS", 1, "field");

      const result = await redis.hpexpireat(
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
      const key = `hpexpireat:${Date.now()}`;

      await redis.hset(key, "field", "value");

      const result = await redis.hpexpireat(key, 0, "FIELDS", 1, "field");

      expect(result).to.deep.equal([2]);
    });

    it("should expire multiple fields", async () => {
      const key = `hpexpireat:${Date.now()}`;
      const expiresAt = Date.now() + 60_000;

      await redis.hset(key, "field", "value", "field2", "value2");

      const result = await redis.hpexpireat(
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
