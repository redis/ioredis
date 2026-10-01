import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hexpiretime (${name})`, function () {
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
      const key = `hexpiretime:${Date.now()}`;

      const result = await redis.hexpiretime(
        key,
        "FIELDS",
        1,
        "non_existing_field"
      );

      expect(result).to.deep.equal([-2]);
    });

    it("should return -1 for field without expiry", async () => {
      const key = `hexpiretime:${Date.now()}`;

      await redis.hset(key, "field", "value");

      const result = await redis.hexpiretime(key, "FIELDS", 1, "field");

      expect(result).to.deep.equal([-1]);
    });

    it("should return expiration unix time for field with expiry", async () => {
      const key = `hexpiretime:${Date.now()}`;
      const expiresAt = Math.floor(Date.now() / 1000) + 60;

      await redis.hset(key, "field", "value");
      await redis.hexpireat(key, expiresAt, "FIELDS", 1, "field");

      const result = await redis.hexpiretime(key, "FIELDS", 1, "field");

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.be.a("number");
      expect(result[0]).equal(expiresAt);
    });

    it("should return timestamps for multiple fields", async () => {
      const key = `hexpiretime:${Date.now()}`;
      const expiresAt = Math.floor(Date.now() / 1000) + 60;

      await redis.hset(key, "field", "value", "field2", "value2");
      await redis.hexpireat(key, expiresAt, "FIELDS", 1, "field");

      const result = await redis.hexpiretime(
        key,
        "FIELDS",
        3,
        "field",
        "field2",
        "non_existing_field"
      );

      expect(result).to.have.lengthOf(3);
      expect(result[0]).to.be.a("number");
      expect(result[0]).equal(expiresAt);
      expect(result[1]).to.equal(-1);
      expect(result[2]).to.equal(-2);
    });
  });
}
