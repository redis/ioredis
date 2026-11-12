import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  // Scores are doubles only under the native RESP3 reply shape.
  const score = (value: number) =>
    opts.replyMapping === "resp3" ? value : String(value);

  describe(`zmovemember (${name})`, function () {
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

    it("moves the named members in argument order", async () => {
      const source = `zmovemember_members_src_${Date.now()}`;
      const destination = `zmovemember_members_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a", 2, "b", 3, "c");

      expect(
        await redis.zmovemember(
          source,
          destination,
          "MEMBERS",
          3,
          "c",
          "missing",
          "a"
        )
      ).to.deep.equal([
        ["c", score(3)],
        ["a", score(1)],
      ]);
      expect(await redis.zrange(source, 0, -1)).to.deep.equal(["b"]);
      expect(await redis.zrange(destination, 0, -1)).to.deep.equal(["a", "c"]);
    });

    it("accepts the members as an array", async () => {
      const source = `zmovemember_array_src_${Date.now()}`;
      const destination = `zmovemember_array_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a", 2, "b");

      expect(
        await redis.zmovemember(source, destination, "MEMBERS", 2, ["a", "b"])
      ).to.deep.equal([
        ["a", score(1)],
        ["b", score(2)],
      ]);
    });

    it("moves only members absent from the destination with NX", async () => {
      const source = `zmovemember_nx_src_${Date.now()}`;
      const destination = `zmovemember_nx_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a", 2, "b");
      await redis.zadd(destination, 10, "a");

      expect(
        await redis.zmovemember(
          source,
          destination,
          "NX",
          "MEMBERS",
          2,
          "a",
          "b"
        )
      ).to.deep.equal([["b", score(2)]]);
      expect(await redis.zrange(source, 0, -1)).to.deep.equal(["a"]);
      expect(await redis.zscore(destination, "a")).to.equal(score(10));
    });

    it("moves only members present in the destination with XX", async () => {
      const source = `zmovemember_xx_src_${Date.now()}`;
      const destination = `zmovemember_xx_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a", 2, "b");
      await redis.zadd(destination, 10, "a");

      expect(
        await redis.zmovemember(
          source,
          destination,
          "XX",
          "MEMBERS",
          2,
          "a",
          "b"
        )
      ).to.deep.equal([["a", score(1)]]);
      expect(await redis.zrange(source, 0, -1)).to.deep.equal(["b"]);
      expect(await redis.zscore(destination, "a")).to.equal(score(1));
    });

    it("returns null when nothing is moved", async () => {
      const source = `zmovemember_missing_src_${Date.now()}`;
      const destination = `zmovemember_missing_dst_${Date.now()}`;

      expect(
        await redis.zmovemember(source, destination, "MEMBERS", 1, "a")
      ).to.equal(null);
    });

    it("returns buffers with zmovememberBuffer", async () => {
      const source = `zmovemember_buffer_src_${Date.now()}`;
      const destination = `zmovemember_buffer_dst_${Date.now()}`;
      await redis.zadd(source, 1, "a");

      const result = await redis.zmovememberBuffer(
        source,
        destination,
        "MEMBERS",
        1,
        "a"
      );

      expect(result).to.have.length(1);
      expect(result![0][0]).to.deep.equal(Buffer.from("a"));
    });

    it("supports callbacks", (done) => {
      const source = `zmovemember_callback_src_${Date.now()}`;
      const destination = `zmovemember_callback_dst_${Date.now()}`;

      redis.zadd(source, 1, "a").then(() => {
        redis.zmovemember(
          source,
          destination,
          "MEMBERS",
          1,
          "a",
          (err, result) => {
            if (err) return done(err);
            expect(result).to.deep.equal([["a", score(1)]]);
            done();
          }
        );
      }, done);
    });
  });
}
