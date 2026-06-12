import Redis from "../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../helpers/util";

describe("replyMapping", function () {
  before(async function () {
    if (await isRedisVersionLowerThan("6.0.0")) {
      this.skip();
    }
  });

  it("rejects the resp3 mapping with protocol 2", () => {
    expect(() => new Redis({ replyMapping: "resp3" })).to.throw(
      /only supported with protocol 3/
    );
  });

  describe("resp3", function () {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis({ protocol: 3, replyMapping: "resp3" });
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("decodes map replies as plain objects with string values", async () => {
      const reply = await redis.config("GET", "maxmemory");

      expect(reply).to.not.be.an("array");
      expect(reply).to.have.property("maxmemory").that.is.a("string");
    });

    it("matches the legacy shape for commands with a reply transformer", async () => {
      await redis.hset("reply_mapping_hash", { f1: "v1", f2: "v2" });

      const legacy = new Redis({ protocol: 3 });
      try {
        const expected = await legacy.hgetall("reply_mapping_hash");

        expect(expected).to.eql({ f1: "v1", f2: "v2" });
        expect(await redis.hgetall("reply_mapping_hash")).to.eql(expected);
      } finally {
        legacy.disconnect();
      }
    });

    it("keeps Buffer values in object replies for Buffer variants", async () => {
      await redis.hset("reply_mapping_hash", "f1", "v1");

      const reply = (await redis.hgetallBuffer("reply_mapping_hash")) as {
        f1: Buffer;
      };

      expect(Buffer.isBuffer(reply.f1)).to.equal(true);
      expect(reply.f1.toString()).to.equal("v1");
    });

    it("decodes double replies as numbers", async () => {
      await redis.zadd("reply_mapping_zset", 1.5, "member");

      expect(await redis.zscore("reply_mapping_zset", "member")).to.equal(1.5);
    });

    it("keeps numerics as strings with stringNumbers", async () => {
      const stringNumbers = new Redis({
        protocol: 3,
        replyMapping: "resp3",
        stringNumbers: true,
      });

      try {
        await stringNumbers.zadd("reply_mapping_zset", 1.5, "member");

        expect(
          await stringNumbers.zscore("reply_mapping_zset", "member")
        ).to.equal("1.5");
        expect(await stringNumbers.incr("reply_mapping_counter")).to.equal(
          "1"
        );
      } finally {
        stringNumbers.disconnect();
      }
    });
  });

  describe("legacy (default)", function () {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis({ protocol: 3 });
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("keeps the RESP2 shape for map replies", async () => {
      const reply = await redis.config("GET", "maxmemory");

      expect(reply).to.be.an("array");
      expect(reply[0]).to.equal("maxmemory");
    });

    it("keeps the RESP2 shape for double replies", async () => {
      await redis.zadd("reply_mapping_zset", 1.5, "member");

      expect(await redis.zscore("reply_mapping_zset", "member")).to.equal(
        "1.5"
      );
    });
  });
});
