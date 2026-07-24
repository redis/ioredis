import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hsetex (${name})`, function () {
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

    it("should return 1 when fields are set", async () => {
      const key = `hsetex:${Date.now()}`;

      const result = await redis.hsetex(
        key,
        "FIELDS",
        2,
        "field1",
        "value1",
        "field2",
        "value2"
      );

      expect(result).to.equal(1);
    });

    it("should return 1 with FNX + EX when fields do not exist", async () => {
      const key = `hsetex:fnx_ex:${Date.now()}`;

      const result = await redis.hsetex(
        key,
        "FNX",
        "EX",
        120,
        "FIELDS",
        2,
        "field1",
        "value1",
        "field2",
        "value2"
      );

      expect(result).to.equal(1);
    });

    it("should return 0 with FNX when any field already exists", async () => {
      const key = `hsetex:fnx:${Date.now()}`;

      await redis.hset(key, "field1", "existing", "field2", "existing");
      const result = await redis.hsetex(
        key,
        "FNX",
        "FIELDS",
        2,
        "field1",
        "value1",
        "field2",
        "value2"
      );

      expect(result).to.equal(0);
    });

    it("should return 0 with FXX when not all fields exist", async () => {
      const key = `hsetex:fxx:${Date.now()}`;

      await redis.hset(key, "field1", "existing");
      const result = await redis.hsetex(
        key,
        "FXX",
        "FIELDS",
        2,
        "field1",
        "value1",
        "field2",
        "value2"
      );

      expect(result).to.equal(0);
    });

    it("should return 1 with FXX + KEEPTTL when all fields exist", async () => {
      const key = `hsetex:fxx_keepttl:${Date.now()}`;

      await redis.hset(key, "field1", "existing1", "field2", "existing2");
      await redis.hpexpire(key, 120_000, "FIELDS", 2, "field1", "field2");

      const result = await redis.hsetex(
        key,
        "FXX",
        "KEEPTTL",
        "FIELDS",
        2,
        "field1",
        "value1",
        "field2",
        "value2"
      );

      expect(result).to.equal(1);
    });

    it("should support PX option", async () => {
      const key = `hsetex:px:${Date.now()}`;

      const result = await redis.hsetex(
        key,
        "PX",
        120_000,
        "FIELDS",
        1,
        "field1",
        "value1"
      );

      expect(result).to.equal(1);
    });

    it("should support EXAT option", async () => {
      const key = `hsetex:exat:${Date.now()}`;
      const expiresAtSeconds = Math.floor(Date.now() / 1000) + 300;

      const result = await redis.hsetex(
        key,
        "EXAT",
        expiresAtSeconds,
        "FIELDS",
        1,
        "field1",
        "value1"
      );

      expect(result).to.equal(1);
    });

    it("should support PXAT option", async () => {
      const key = `hsetex:pxat:${Date.now()}`;
      const expiresAtMilliseconds = Date.now() + 300_000;

      const result = await redis.hsetex(
        key,
        "PXAT",
        expiresAtMilliseconds,
        "FIELDS",
        1,
        "field1",
        "value1"
      );

      expect(result).to.equal(1);
    });

    it("should support KEEPTTL option", async () => {
      const key = `hsetex:keepttl:${Date.now()}`;

      await redis.hsetex(key, "EX", 120, "FIELDS", 1, "field1", "value1");
      const result = await redis.hsetex(
        key,
        "KEEPTTL",
        "FIELDS",
        1,
        "field1",
        "value2"
      );

      expect(result).to.equal(1);
    });
  });
}
