import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`saddex (${name})`, function () {
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

    it("returns 1 when members are added without an expiration", async () => {
      const key = `saddex_add_${Date.now()}`;

      expect(await redis.saddex(key, "MEMBERS", 2, "a", "b")).to.equal(1);
      expect((await redis.smembers(key)).sort()).to.deep.equal(["a", "b"]);
      expect(await redis.sttl(key, "MEMBERS", 2, "a", "b")).to.deep.equal([
        -1, -1,
      ]);
    });

    it("returns 0 when nothing changes", async () => {
      const key = `saddex_unchanged_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(await redis.saddex(key, "MEMBERS", 1, "a")).to.equal(0);
    });

    it("sets the expiration with EX", async () => {
      const key = `saddex_ex_${Date.now()}`;

      expect(await redis.saddex(key, "EX", 60, "MEMBERS", 1, "a")).to.equal(1);

      const [ttl] = await redis.sttl(key, "MEMBERS", 1, "a");
      expect(ttl).to.be.greaterThan(0).and.at.most(60);
    });

    it("sets the expiration with PXAT", async () => {
      const key = `saddex_pxat_${Date.now()}`;
      const expiresAt = Date.now() + 60_000;

      expect(
        await redis.saddex(key, "PXAT", expiresAt, "MEMBERS", 1, "a")
      ).to.equal(1);
      expect(await redis.spexpiretime(key, "MEMBERS", 1, "a")).to.deep.equal([
        expiresAt,
      ]);
    });

    it("keeps the existing expiration with KEEPTTL", async () => {
      const key = `saddex_keepttl_${Date.now()}`;
      await redis.saddex(key, "EX", 60, "MEMBERS", 1, "a");

      expect(await redis.saddex(key, "KEEPTTL", "MEMBERS", 1, "a")).to.equal(0);

      const [ttl] = await redis.sttl(key, "MEMBERS", 1, "a");
      expect(ttl).to.be.greaterThan(0);
    });

    it("discards the existing expiration without KEEPTTL", async () => {
      const key = `saddex_discard_${Date.now()}`;
      await redis.saddex(key, "EX", 60, "MEMBERS", 1, "a");

      expect(await redis.saddex(key, "MEMBERS", 1, "a")).to.equal(1);
      expect(await redis.sttl(key, "MEMBERS", 1, "a")).to.deep.equal([-1]);
    });

    it("returns 0 with MNX when any member already exists", async () => {
      const key = `saddex_mnx_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(
        await redis.saddex(key, "MNX", "EX", 60, "MEMBERS", 2, "a", "b")
      ).to.equal(0);
      expect(await redis.smembers(key)).to.deep.equal(["a"]);
    });

    it("returns 0 with MXX when not all members exist", async () => {
      const key = `saddex_mxx_missing_${Date.now()}`;
      await redis.sadd(key, "a");

      expect(
        await redis.saddex(key, "MXX", "EX", 60, "MEMBERS", 2, "a", "b")
      ).to.equal(0);
    });

    it("returns 1 with MXX when all members exist", async () => {
      const key = `saddex_mxx_${Date.now()}`;
      await redis.sadd(key, "a", "b");

      expect(
        await redis.saddex(key, "MXX", "EX", 60, "MEMBERS", 2, "a", "b")
      ).to.equal(1);
    });

    it("deletes members when the expiration is in the past", async () => {
      const key = `saddex_past_${Date.now()}`;
      await redis.sadd(key, "a", "b");

      expect(await redis.saddex(key, "EXAT", 1, "MEMBERS", 1, "a")).to.equal(1);
      expect(await redis.smembers(key)).to.deep.equal(["b"]);
    });

    it("accepts members as an array", async () => {
      const key = `saddex_array_${Date.now()}`;

      expect(
        await redis.saddex(key, "PX", 60_000, "MEMBERS", 2, ["a", "b"])
      ).to.equal(1);
      expect((await redis.smembers(key)).sort()).to.deep.equal(["a", "b"]);
    });

    it("accepts Buffer members", async () => {
      const key = `saddex_buffer_${Date.now()}`;

      expect(
        await redis.saddex(key, "MEMBERS", 1, Buffer.from("member"))
      ).to.equal(1);
      expect(await redis.smembersBuffer(key)).to.deep.equal([
        Buffer.from("member"),
      ]);
    });

    it("supports callbacks", (done) => {
      const key = `saddex_callback_${Date.now()}`;

      redis.saddex(key, "EX", 60, "MEMBERS", 1, "a", (err, result) => {
        if (err) return done(err);
        expect(result).to.equal(1);
        done();
      });
    });
  });
}
