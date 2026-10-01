import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`blmpop (${name})`, function () {
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

    it("returns null when the timeout elapses", async () => {
      const key = `blmpop:${Date.now()}`;

      expect(await redis.blmpop(0.001, 1, key, "LEFT")).to.equal(null);
    });

    it("returns the key and popped members", async () => {
      const key = `blmpop:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.blmpop(0.001, 1, key, "LEFT")).to.eql([key, ["a"]]);
    });
  });
}
