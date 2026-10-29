import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`spersist (${name})`, function () {
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

    it("returns 1 and removes the expiration of a member", async () => {
      const key = `spersist_remove_${Date.now()}`;
      await redis.sadd(key, "a");
      await redis.sexpire(key, 60, "MEMBERS", 1, "a");

      expect(await redis.spersist(key, "MEMBERS", 1, "a")).to.deep.equal([1]);
      expect(await redis.sttl(key, "MEMBERS", 1, "a")).to.deep.equal([-1]);
    });

    it("returns -1 for a member without an expiration", async () => {
      const key = `spersist_persistent_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(await redis.spersist(key, "MEMBERS", 1, "a")).to.deep.equal([-1]);
    });

    it("returns -2 for a non-existing key", async () => {
      const key = `spersist_missing_key_${Date.now()}`;

      expect(await redis.spersist(key, "MEMBERS", 1, "a")).to.deep.equal([-2]);
    });

    it("returns a value for each member", async () => {
      const key = `spersist_multiple_${Date.now()}`;
      await redis.sadd(key, "a", "b");
      await redis.sexpire(key, 60, "MEMBERS", 1, "a");

      expect(
        await redis.spersist(key, "MEMBERS", 3, ["a", "b", "missing"])
      ).to.deep.equal([1, -1, -2]);
    });

    it("supports callbacks", (done) => {
      const key = `spersist_callback_${Date.now()}`;

      redis.spersist(key, "MEMBERS", 1, "a", (err, result) => {
        if (err) return done(err);
        expect(result).to.deep.equal([-2]);
        done();
      });
    });
  });
}
