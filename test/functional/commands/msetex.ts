import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`msetex (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("8.4")) {
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

    it("should set a single key and return 1", async () => {
      const key = `msetex:${Date.now()}`;

      const result = await redis.msetex(1, key, "value1");

      expect(result).to.equal(1);
    });

    it("should set multiple keys and return 1", async () => {
      const ts = Date.now();
      const key1 = `msetex:${ts}:1`;
      const key2 = `msetex:${ts}:2`;

      const result = await redis.msetex(2, key1, "value1", key2, "value2");

      expect(result).to.equal(1);
    });

    it("should return 1 with NX when none of the keys exist", async () => {
      const key = `msetex:${Date.now()}`;

      const result = await redis.msetex(1, key, "value1", "NX");

      expect(result).to.equal(1);
    });

    it("should return 0 with NX when any key already exists", async () => {
      const key = `msetex:${Date.now()}`;

      await redis.set(key, "existing");
      const result = await redis.msetex(1, key, "value1", "NX");

      expect(result).to.equal(0);
    });

    it("should return 0 with XX when keys do not exist", async () => {
      const key = `msetex:${Date.now()}`;

      const result = await redis.msetex(1, key, "value1", "XX");

      expect(result).to.equal(0);
    });

    it("should return 1 with XX when all keys already exist", async () => {
      const key = `msetex:${Date.now()}`;

      await redis.set(key, "existing");
      const result = await redis.msetex(1, key, "updated", "XX");

      expect(result).to.equal(1);
    });

    it("should set a TTL with EX option", async () => {
      const key = `msetex:${Date.now()}`;

      const result = await redis.msetex(1, key, "value1", "EX", 120);

      expect(result).to.equal(1);
    });

    it("should set a TTL with PX option", async () => {
      const key = `msetex:${Date.now()}`;

      const result = await redis.msetex(1, key, "value1", "PX", 120_000);

      expect(result).to.equal(1);
    });

    it("should set a TTL with EXAT option", async () => {
      const key = `msetex:${Date.now()}`;
      const expiresAt = Math.floor(Date.now() / 1000) + 300;

      const result = await redis.msetex(1, key, "value1", "EXAT", expiresAt);

      expect(result).to.equal(1);
    });

    it("should set a TTL with PXAT option", async () => {
      const key = `msetex:${Date.now()}`;
      const expiresAt = Date.now() + 300_000;

      const result = await redis.msetex(1, key, "value1", "PXAT", expiresAt);

      expect(result).to.equal(1);
    });

    it("should support KEEPTTL option", async () => {
      const key = `msetex:${Date.now()}`;

      await redis.msetex(1, key, "original", "EX", 120);
      const result = await redis.msetex(1, key, "updated", "KEEPTTL");

      expect(result).to.equal(1);
    });

    it("should support combined NX + EX options", async () => {
      const key = `msetex:${Date.now()}`;

      const first = await redis.msetex(1, key, "value1", "NX", "EX", 120);
      const second = await redis.msetex(1, key, "value2", "NX", "EX", 120);

      expect(first).to.equal(1);
      expect(second).to.equal(0);
    });
  });
}
