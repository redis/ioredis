import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`spttl (${name})`, function () {
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

    it("returns -2 for a non-existing member", async () => {
      const key = `spttl_missing_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(await redis.spttl(key, "MEMBERS", 1, "missing")).to.deep.equal([
        -2,
      ]);
    });

    it("returns -2 for a non-existing key", async () => {
      const key = `spttl_missing_key_${Date.now()}`;

      expect(await redis.spttl(key, "MEMBERS", 1, "a")).to.deep.equal([-2]);
    });

    it("returns -1 for a member without an expiration", async () => {
      const key = `spttl_persistent_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(await redis.spttl(key, "MEMBERS", 1, "a")).to.deep.equal([-1]);
    });

    it("returns a value for each member", async () => {
      const key = `spttl_multiple_${Date.now()}`;
      await redis.sadd(key, "a", "b");
      await redis.spexpire(key, 60_000, "MEMBERS", 1, "a");

      const result = await redis.spttl(key, "MEMBERS", 3, [
        "a",
        "b",
        "missing",
      ]);

      expect(result).to.have.lengthOf(3);
      expect(result[0]).to.be.greaterThan(0).and.at.most(60_000);
      expect(result.slice(1)).to.deep.equal([-1, -2]);
    });

    it("supports callbacks", (done) => {
      const key = `spttl_callback_${Date.now()}`;

      redis.spttl(key, "MEMBERS", 1, "a", (err, result) => {
        if (err) return done(err);
        expect(result).to.deep.equal([-2]);
        done();
      });
    });
  });
}
