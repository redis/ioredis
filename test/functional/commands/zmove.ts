import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  // Scores are doubles only under the native RESP3 reply shape.
  const score = (value: number) =>
    opts.replyMapping === "resp3" ? value : String(value);

  describe(`zmove (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("8.11")) {
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

    it("moves the lowest-scoring member with MIN", async () => {
      const source = `zmove_min_src_${Date.now()}`;
      const destination = `zmove_min_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a", 2, "b", 3, "c");

      expect(await redis.zmove(source, destination, "MIN")).to.deep.equal([
        ["a", score(1)],
      ]);
      expect(await redis.zrange(source, 0, -1)).to.deep.equal(["b", "c"]);
      expect(await redis.zrange(destination, 0, -1)).to.deep.equal(["a"]);
    });

    it("moves the highest-scoring members with MAX and COUNT", async () => {
      const source = `zmove_max_src_${Date.now()}`;
      const destination = `zmove_max_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a", 2, "b", 3, "c");

      expect(
        await redis.zmove(source, destination, "MAX", "COUNT", 2)
      ).to.deep.equal([
        ["c", score(3)],
        ["b", score(2)],
      ]);
      expect(await redis.zrange(source, 0, -1)).to.deep.equal(["a"]);
    });

    it("moves a score range with BYSCORE", async () => {
      const source = `zmove_byscore_src_${Date.now()}`;
      const destination = `zmove_byscore_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a", 2, "b", 3, "c", 4, "d");

      expect(
        await redis.zmove(
          source,
          destination,
          "BYSCORE",
          "(1",
          "+inf",
          "COUNT",
          2
        )
      ).to.deep.equal([
        ["b", score(2)],
        ["c", score(3)],
      ]);
      expect(
        await redis.zmove(source, destination, "BYSCORE", 1, 4)
      ).to.deep.equal([
        ["a", score(1)],
        ["d", score(4)],
      ]);
      expect(await redis.exists(source)).to.equal(0);
    });

    it("returns null when nothing is moved", async () => {
      const source = `zmove_missing_src_${Date.now()}`;
      const destination = `zmove_missing_dst_${Date.now()}`;

      expect(await redis.zmove(source, destination, "MIN")).to.equal(null);
    });

    it("returns buffers with zmoveBuffer", async () => {
      const source = `zmove_buffer_src_${Date.now()}`;
      const destination = `zmove_buffer_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a");

      const result = await redis.zmoveBuffer(source, destination, "MIN");

      expect(result).to.have.length(1);
      expect(result![0][0]).to.deep.equal(Buffer.from("a"));
    });

    it("supports callbacks", (done) => {
      const source = `zmove_callback_src_${Date.now()}`;
      const destination = `zmove_callback_dst_${Date.now()}`;

      redis.zadd(source, 1, "a").then(() => {
        redis.zmove(source, destination, "MIN", (err, result) => {
          if (err) return done(err);
          expect(result).to.deep.equal([["a", score(1)]]);
          done();
        });
      }, done);
    });
  });
}
