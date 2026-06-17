import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lmpop (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("7.0")) {
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

    it("returns null when no key has elements", async () => {
      const key = `lmpop:${Date.now()}`;

      expect(await redis.lmpop(1, key, "LEFT")).to.equal(null);
    });

    it("returns the key and popped members", async () => {
      const key = `lmpop:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.lmpop(1, key, "LEFT")).to.eql([key, ["a"]]);
    });
  });
}
