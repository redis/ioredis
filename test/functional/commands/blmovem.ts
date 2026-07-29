import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`blmovem (${name})`, function () {
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

    it("returns null when the timeout elapses", async () => {
      const source = `blmovem:timeout:${Date.now()}:src`;
      const destination = `blmovem:timeout:${Date.now()}:dst`;

      expect(
        await redis.blmovem(
          source,
          destination,
          "LEFT",
          "RIGHT",
          0.001,
          "EXACTLY",
          2,
          "BULK"
        )
      ).to.equal(null);
    });

    it("moves available elements and returns them", async () => {
      const source = `blmovem:count:${Date.now()}:src`;
      const destination = `blmovem:count:${Date.now()}:dst`;
      await redis.rpush(source, "a", "b", "c");

      expect(
        await redis.blmovem(
          source,
          destination,
          "LEFT",
          "RIGHT",
          0,
          "COUNT",
          2,
          "BULK"
        )
      ).to.eql(["a", "b"]);
      expect(await redis.lrange(source, 0, -1)).to.eql(["c"]);
      expect(await redis.lrange(destination, 0, -1)).to.eql(["a", "b"]);
    });
  });
}
