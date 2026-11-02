import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`spexpireat (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("8.12")) {
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

    it("returns 1 and sets the given expiration time", async () => {
      const key = `spexpireat_set_${Date.now()}`;
      const expiresAt = Date.now() + 60_000;
      await redis.sadd(key, "a");

      expect(
        await redis.spexpireat(key, expiresAt, "MEMBERS", 1, "a")
      ).to.deep.equal([1]);
      expect(await redis.spexpiretime(key, "MEMBERS", 1, "a")).to.deep.equal([
        expiresAt,
      ]);
    });

    it("returns a value for each member", async () => {
      const key = `spexpireat_multiple_${Date.now()}`;
      const expiresAt = Date.now() + 60_000;
      await redis.sadd(key, "a");

      expect(
        await redis.spexpireat(key, expiresAt, "MEMBERS", 2, "a", "missing")
      ).to.deep.equal([1, -2]);
    });

    it("returns 0 when the GT condition is not met", async () => {
      const key = `spexpireat_gt_${Date.now()}`;
      const expiresAt = Date.now() + 60_000;
      await redis.sadd(key, "a");
      await redis.spexpireat(key, expiresAt, "MEMBERS", 1, "a");

      expect(
        await redis.spexpireat(key, expiresAt - 1_000, "GT", "MEMBERS", 1, "a")
      ).to.deep.equal([0]);
    });

    it("returns 2 and deletes the member when the time is in the past", async () => {
      const key = `spexpireat_past_${Date.now()}`;
      await redis.sadd(key, "a", "b");

      expect(await redis.spexpireat(key, 1, "MEMBERS", 1, "a")).to.deep.equal([
        2,
      ]);
      expect(await redis.smembers(key)).to.deep.equal(["b"]);
    });
  });
}
