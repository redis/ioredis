import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lmovem (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("8.9")) {
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

    it("returns null when the source is missing", async () => {
      const source = `lmovem:missing:${Date.now()}:src`;
      const destination = `lmovem:missing:${Date.now()}:dst`;

      expect(await redis.lmovem(source, destination, "LEFT", "RIGHT")).to.equal(
        null
      );
    });

    it("moves one element when no count is provided", async () => {
      const source = `lmovem:single:${Date.now()}:src`;
      const destination = `lmovem:single:${Date.now()}:dst`;
      await redis.rpush(source, "a", "b", "c");

      expect(
        await redis.lmovem(source, destination, "LEFT", "RIGHT")
      ).to.eql(["a"]);
      expect(await redis.lrange(source, 0, -1)).to.eql(["b", "c"]);
      expect(await redis.lrange(destination, 0, -1)).to.eql(["a"]);
    });

    it("supports COUNT with OBO and BULK ordering", async () => {
      const oboSource = `lmovem:obo:${Date.now()}:src`;
      const oboDestination = `lmovem:obo:${Date.now()}:dst`;
      await redis.rpush(oboSource, "1", "2", "3", "4");

      expect(
        await redis.lmovem(
          oboSource,
          oboDestination,
          "LEFT",
          "LEFT",
          "COUNT",
          3,
          "OBO"
        )
      ).to.eql(["3", "2", "1"]);

      const bulkSource = `lmovem:bulk:${Date.now()}:src`;
      const bulkDestination = `lmovem:bulk:${Date.now()}:dst`;
      await redis.rpush(bulkSource, "1", "2", "3", "4");

      expect(
        await redis.lmovem(
          bulkSource,
          bulkDestination,
          "LEFT",
          "LEFT",
          "COUNT",
          3,
          "BULK"
        )
      ).to.eql(["1", "2", "3"]);
    });

    it("returns null without moving when EXACTLY cannot be satisfied", async () => {
      const source = `lmovem:exactly:${Date.now()}:src`;
      const destination = `lmovem:exactly:${Date.now()}:dst`;
      await redis.rpush(source, "a", "b");

      expect(
        await redis.lmovem(
          source,
          destination,
          "LEFT",
          "RIGHT",
          "EXACTLY",
          3,
          "BULK"
        )
      ).to.equal(null);
      expect(await redis.lrange(source, 0, -1)).to.eql(["a", "b"]);
      expect(await redis.exists(destination)).to.equal(0);
    });

    it("returns buffers from the buffer variant", async () => {
      const source = `lmovem:buffer:${Date.now()}:src`;
      const destination = `lmovem:buffer:${Date.now()}:dst`;
      await redis.rpush(source, Buffer.from([0xff]), Buffer.from("value"));

      expect(
        await redis.lmovemBuffer(
          source,
          destination,
          "LEFT",
          "RIGHT",
          "COUNT",
          2,
          "BULK"
        )
      ).to.eql([Buffer.from([0xff]), Buffer.from("value")]);
    });
  });
}
