import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sexpiretime (${name})`, function () {
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
      const key = `sexpiretime_missing_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(
        await redis.sexpiretime(key, "MEMBERS", 1, "missing")
      ).to.deep.equal([-2]);
    });

    it("returns -2 for a non-existing key", async () => {
      const key = `sexpiretime_missing_key_${Date.now()}`;

      expect(await redis.sexpiretime(key, "MEMBERS", 1, "a")).to.deep.equal([
        -2,
      ]);
    });

    it("returns -1 for a member without an expiration", async () => {
      const key = `sexpiretime_persistent_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(await redis.sexpiretime(key, "MEMBERS", 1, "a")).to.deep.equal([
        -1,
      ]);
    });

    it("returns a value for each member", async () => {
      const key = `sexpiretime_multiple_${Date.now()}`;
      const expiresAt = Math.floor(Date.now() / 1000) + 60;
      await redis.sadd(key, "a", "b");
      await redis.sexpireat(key, expiresAt, "MEMBERS", 1, "a");

      const result = await redis.sexpiretime(key, "MEMBERS", 3, [
        "a",
        "b",
        "missing",
      ]);

      expect(result).to.have.lengthOf(3);
      expect(result[0]).to.equal(expiresAt);
      expect(result.slice(1)).to.deep.equal([-1, -2]);
    });

    it("supports callbacks", (done) => {
      const key = `sexpiretime_callback_${Date.now()}`;

      redis.sexpiretime(key, "MEMBERS", 1, "a", (err, result) => {
        if (err) return done(err);
        expect(result).to.deep.equal([-2]);
        done();
      });
    });
  });
}
