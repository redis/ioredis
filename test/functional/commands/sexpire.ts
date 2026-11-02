import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sexpire (${name})`, function () {
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
      const key = `sexpire_set_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(await redis.sexpire(key, 60, "MEMBERS", 1, "a")).to.deep.equal([
        1,
      ]);

      const [ttl] = await redis.sttl(key, "MEMBERS", 1, "a");
      expect(ttl).to.be.greaterThan(0).and.at.most(60);
    });

    it("returns a value for each member", async () => {
      const key = `sexpire_multiple_${Date.now()}`;
      await redis.sadd(key, "a", "b");

      expect(
        await redis.sexpire(key, 60, "MEMBERS", 3, "a", "b", "missing")
      ).to.deep.equal([1, 1, -2]);
    });

    it("returns -2 for a non-existing key", async () => {
      const key = `sexpire_missing_${Date.now()}`;

      expect(await redis.sexpire(key, 60, "MEMBERS", 1, "a")).to.deep.equal([
        -2,
      ]);
    });

    it("returns 0 when the NX condition is not met", async () => {
      const key = `sexpire_nx_${Date.now()}`;
      await redis.sadd(key, "a");
      await redis.sexpire(key, 60, "MEMBERS", 1, "a");

      expect(
        await redis.sexpire(key, 120, "NX", "MEMBERS", 1, "a")
      ).to.deep.equal([0]);
    });

    it("returns 0 when the XX condition is not met", async () => {
      const key = `sexpire_xx_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(
        await redis.sexpire(key, 60, "XX", "MEMBERS", 1, "a")
      ).to.deep.equal([0]);
    });

    it("applies the GT and LT conditions", async () => {
      const key = `sexpire_gt_lt_${Date.now()}`;
      await redis.sadd(key, "a");
      await redis.sexpire(key, 60, "MEMBERS", 1, "a");

      expect(
        await redis.sexpire(key, 30, "GT", "MEMBERS", 1, "a")
      ).to.deep.equal([0]);
      expect(
        await redis.sexpire(key, 120, "GT", "MEMBERS", 1, "a")
      ).to.deep.equal([1]);
      expect(
        await redis.sexpire(key, 30, "LT", "MEMBERS", 1, "a")
      ).to.deep.equal([1]);
    });

    it("returns 2 and deletes the member when expiring with 0 seconds", async () => {
      const key = `sexpire_zero_${Date.now()}`;
      await redis.sadd(key, "a", "b");

      expect(await redis.sexpire(key, 0, "MEMBERS", 1, "a")).to.deep.equal([2]);
      expect(await redis.smembers(key)).to.deep.equal(["b"]);
    });

    it("accepts members as an array", async () => {
      const key = `sexpire_array_${Date.now()}`;
      await redis.sadd(key, "a", "b");

      expect(
        await redis.sexpire(key, 60, "MEMBERS", 2, ["a", "b"])
      ).to.deep.equal([1, 1]);
    });

    it("supports callbacks", (done) => {
      const key = `sexpire_callback_${Date.now()}`;

      redis.sadd(key, "a").then(() => {
        redis.sexpire(key, 60, "MEMBERS", 1, "a", (err, result) => {
          if (err) return done(err);
          expect(result).to.deep.equal([1]);
          done();
        });
      }, done);
    });
  });
}
