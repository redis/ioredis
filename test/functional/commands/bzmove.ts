import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  // Scores are doubles only under the native RESP3 reply shape.
  const score = (value: number) =>
    opts.replyMapping === "resp3" ? value : String(value);

  describe(`bzmove (${name})`, function () {
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
      const source = `bzmove_min_src_${Date.now()}`;
      const destination = `bzmove_min_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a", 2, "b");

      expect(await redis.bzmove(source, destination, "MIN", 1)).to.deep.equal([
        ["a", score(1)],
      ]);
      expect(await redis.zrange(destination, 0, -1)).to.deep.equal(["a"]);
    });

    it("moves the highest-scoring members with MAX and COUNT", async () => {
      const source = `bzmove_max_src_${Date.now()}`;
      const destination = `bzmove_max_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a", 2, "b", 3, "c");

      expect(
        await redis.bzmove(source, destination, "MAX", 1, "COUNT", 2)
      ).to.deep.equal([
        ["c", score(3)],
        ["b", score(2)],
      ]);
      expect(await redis.zrange(source, 0, -1)).to.deep.equal(["a"]);
    });

    it("blocks until the source has a member", async () => {
      const source = `bzmove_block_src_${Date.now()}`;
      const destination = `bzmove_block_dst_${Date.now()}`;
      const writer = new Redis(opts);

      try {
        const pending = redis.bzmove(source, destination, "MIN", 5);
        await writer.zadd(source, 1, "a");

        expect(await pending).to.deep.equal([["a", score(1)]]);
      } finally {
        writer.disconnect();
      }
    });

    it("returns null on timeout", async () => {
      const source = `bzmove_timeout_src_${Date.now()}`;
      const destination = `bzmove_timeout_dst_${Date.now()}`;

      expect(await redis.bzmove(source, destination, "MIN", 0.01)).to.equal(
        null
      );
    });

    it("returns buffers with bzmoveBuffer", async () => {
      const source = `bzmove_buffer_src_${Date.now()}`;
      const destination = `bzmove_buffer_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a");

      const result = await redis.bzmoveBuffer(source, destination, "MIN", 1);

      expect(result).to.have.length(1);
      expect(result![0][0]).to.deep.equal(Buffer.from("a"));
    });

    it("supports callbacks", (done) => {
      const source = `bzmove_callback_src_${Date.now()}`;
      const destination = `bzmove_callback_dst_${Date.now()}`;

      redis.zadd(source, 1, "a").then(() => {
        redis.bzmove(source, destination, "MIN", 1, (err, result) => {
          if (err) return done(err);
          expect(result).to.deep.equal([["a", score(1)]]);
          done();
        });
      }, done);
    });
  });
}
