import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sintercard (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing set", async function () {
      if (await isRedisVersionLowerThan("7.0.0")) {
        return this.skip();
      }

      const key = `sintercard:${Date.now()}`;

      expect(await redis.sintercard(1, key)).to.equal(0);
    });

    it("returns the cardinality of the intersection", async function () {
      if (await isRedisVersionLowerThan("7.0.0")) {
        return this.skip();
      }

      const key1 = `sintercard:${Date.now()}:1`;
      const key2 = `sintercard:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c"]);
      await redis.sadd(key2, ["b", "c", "d"]);

      expect(await redis.sintercard(2, key1, key2)).to.equal(2);
    });
  });
}
