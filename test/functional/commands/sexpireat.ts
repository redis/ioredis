import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sexpireat (${name})`, function () {
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
      const key = `sexpireat_set_${Date.now()}`;
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      await redis.sadd(key, "a");

      expect(
        await redis.sexpireat(key, expiresAt, "MEMBERS", 1, "a")
      ).to.deep.equal([1]);
      expect(await redis.sexpiretime(key, "MEMBERS", 1, "a")).to.deep.equal([
        expiresAt,
      ]);
    });

    it("returns a value for each member", async () => {
      const key = `sexpireat_multiple_${Date.now()}`;
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      await redis.sadd(key, "a");

      expect(
        await redis.sexpireat(key, expiresAt, "MEMBERS", 2, "a", "missing")
      ).to.deep.equal([1, -2]);
    });

    it("returns 0 when the NX condition is not met", async () => {
      const key = `sexpireat_nx_${Date.now()}`;
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      await redis.sadd(key, "a");
      await redis.sexpireat(key, expiresAt, "MEMBERS", 1, "a");

      expect(
        await redis.sexpireat(key, expiresAt + 60, "NX", "MEMBERS", 1, "a")
      ).to.deep.equal([0]);
    });

    it("returns 2 and deletes the member when the time is in the past", async () => {
      const key = `sexpireat_past_${Date.now()}`;
      await redis.sadd(key, "a", "b");

      expect(await redis.sexpireat(key, 1, "MEMBERS", 1, "a")).to.deep.equal([
        2,
      ]);
      expect(await redis.smembers(key)).to.deep.equal(["b"]);
    });
  });
}
