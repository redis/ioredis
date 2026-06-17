import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`httl (${name})`, function () {
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

    it("should return -2 for non-existing field", async () => {
      const key = `httl:${Date.now()}`;

      const result = await redis.httl(key, "FIELDS", 1, "non_existing_field");

      expect(result).to.deep.equal([-2]);
    });

    it("should return -1 for field without expiry", async () => {
      const key = `httl:${Date.now()}`;

      await redis.hset(key, "field", "value");
      const result = await redis.httl(key, "FIELDS", 1, "field");

      expect(result).to.deep.equal([-1]);
    });

    it("should return ttl in seconds for field with expiry", async () => {
      const key = `httl:${Date.now()}`;
      const expiresAt = Date.now() + 60_000;

      await redis.hset(key, "field", "value");
      await redis.hpexpireat(key, expiresAt, "FIELDS", 1, "field");

      const result = await redis.httl(key, "FIELDS", 1, "field");

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.be.greaterThan(0);
    });

    it("should return ttl, -1, and -2 for mixed fields", async () => {
      const key = `httl:${Date.now()}`;
      const expiresAt = Date.now() + 60_000;

      await redis.hset(key, "field1", "value1", "field2", "value2");
      await redis.hpexpireat(key, expiresAt, "FIELDS", 1, "field1");

      const result = await redis.httl(
        key,
        "FIELDS",
        3,
        "field1",
        "field2",
        "missing_field"
      );

      expect(result).to.have.lengthOf(3);
      expect(result[0]).to.be.greaterThan(0);
      expect(result[1]).to.equal(-1);
      expect(result[2]).to.equal(-2);
    });
  });
}
