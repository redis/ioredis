import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`spexpire (${name})`, function () {
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

    it("returns 1 when an expiration is set on an existing member", async () => {
      const key = `spexpire_set_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(
        await redis.spexpire(key, 60_000, "MEMBERS", 1, "a")
      ).to.deep.equal([1]);

      const [ttl] = await redis.spttl(key, "MEMBERS", 1, "a");
      expect(ttl).to.be.greaterThan(0).and.at.most(60_000);
    });

    it("returns a value for each member", async () => {
      const key = `spexpire_multiple_${Date.now()}`;
      await redis.sadd(key, "a", "b");

      expect(
        await redis.spexpire(key, 60_000, "MEMBERS", 3, "a", "b", "missing")
      ).to.deep.equal([1, 1, -2]);
    });

    it("returns 0 when the XX condition is not met", async () => {
      const key = `spexpire_xx_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(
        await redis.spexpire(key, 60_000, "XX", "MEMBERS", 1, "a")
      ).to.deep.equal([0]);
    });

    it("returns 2 and deletes the member when expiring with 0 milliseconds", async () => {
      const key = `spexpire_zero_${Date.now()}`;
      await redis.sadd(key, "a", "b");

      expect(await redis.spexpire(key, 0, "MEMBERS", 1, "a")).to.deep.equal([
        2,
      ]);
      expect(await redis.smembers(key)).to.deep.equal(["b"]);
    });
  });
}
