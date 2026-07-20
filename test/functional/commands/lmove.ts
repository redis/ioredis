import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lmove (${name})`, function () {
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

    it("returns null when the source is missing", async () => {
      const source = `lmove:${Date.now()}:src`;
      const destination = `lmove:${Date.now()}:dst`;

      expect(await redis.lmove(source, destination, "LEFT", "RIGHT")).to.equal(
        null
      );
    });

    it("moves an element and returns it", async () => {
      const source = `lmove:${Date.now()}:src`;
      const destination = `lmove:${Date.now()}:dst`;
      await redis.rpush(source, "a", "b", "c");

      expect(await redis.lmove(source, destination, "LEFT", "RIGHT")).to.equal(
        "a"
      );
      expect(await redis.lrange(source, 0, -1)).to.eql(["b", "c"]);
      expect(await redis.lrange(destination, 0, -1)).to.eql(["a"]);
    });
  });
}
