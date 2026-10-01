import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`blmove (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("6.2")) {
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
      const source = `blmove:${Date.now()}:src`;
      const destination = `blmove:${Date.now()}:dst`;

      expect(
        await redis.blmove(source, destination, "LEFT", "RIGHT", 0.001)
      ).to.equal(null);
    });

    it("moves an element and returns it", async () => {
      const source = `blmove:${Date.now()}:src`;
      const destination = `blmove:${Date.now()}:dst`;
      await redis.rpush(source, "a", "b", "c");

      expect(
        await redis.blmove(source, destination, "LEFT", "RIGHT", 0.001)
      ).to.equal("a");
      expect(await redis.lrange(source, 0, -1)).to.eql(["b", "c"]);
      expect(await redis.lrange(destination, 0, -1)).to.eql(["a"]);
    });
  });
}
