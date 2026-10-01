import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hgetex (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("8.0")) {
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

    it("should return values and null for missing field", async () => {
      const key = `hgetex:${Date.now()}`;

      await redis.hset(key, "field1", "value1", "field2", "value2");
      const result = await redis.hgetex(
        key,
        "FIELDS",
        3,
        "field1",
        "field2",
        "missing_field"
      );

      expect(result).to.deep.equal(["value1", "value2", null]);
    });

    it("should return buffers and null for missing field", async () => {
      const key = `hgetex:buf:${Date.now()}`;

      await redis.hset(key, "field1", "value1", "field2", "value2");
      const result = await redis.hgetexBuffer(
        key,
        "PERSIST",
        "FIELDS",
        3,
        "field1",
        "field2",
        "missing_field"
      );

      expect(result).to.have.lengthOf(3);
      expect(result[0]?.toString()).to.equal("value1");
      expect(result[1]?.toString()).to.equal("value2");
      expect(result[2]).to.equal(null);
    });

    it("should support EX option", async () => {
      const key = `hgetex:ex:${Date.now()}`;

      await redis.hset(key, "field1", "value1");
      const result = await redis.hgetex(key, "EX", 60, "FIELDS", 1, "field1");

      expect(result).to.deep.equal(["value1"]);
    });

    it("should support PX option", async () => {
      const key = `hgetex:px:${Date.now()}`;

      await redis.hset(key, "field1", "value1");
      const result = await redis.hgetex(key, "PX", 60_000, "FIELDS", 1, "field1");

      expect(result).to.deep.equal(["value1"]);
    });

    it("should support EXAT option", async () => {
      const key = `hgetex:exat:${Date.now()}`;
      const expiresAtSeconds = Math.floor(Date.now() / 1000) + 60;

      await redis.hset(key, "field1", "value1");
      const result = await redis.hgetex(
        key,
        "EXAT",
        expiresAtSeconds,
        "FIELDS",
        1,
        "field1"
      );

      expect(result).to.deep.equal(["value1"]);
    });

    it("should support PXAT option", async () => {
      const key = `hgetex:pxat:${Date.now()}`;
      const expiresAtMilliseconds = Date.now() + 60_000;

      await redis.hset(key, "field1", "value1");
      const result = await redis.hgetex(
        key,
        "PXAT",
        expiresAtMilliseconds,
        "FIELDS",
        1,
        "field1"
      );

      expect(result).to.deep.equal(["value1"]);
    });

    it("should support PERSIST option", async () => {
      const key = `hgetex:persist:${Date.now()}`;

      await redis.hset(key, "field1", "value1");
      const result = await redis.hgetex(key, "PERSIST", "FIELDS", 1, "field1");

      expect(result).to.deep.equal(["value1"]);
    });
  });
}
