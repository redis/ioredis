import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`smismember (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for each missing member", async function () {
      if (await isRedisVersionLowerThan("6.2.0")) {
        return this.skip();
      }

      const key = `smismember:${Date.now()}`;

      expect(await redis.smismember(key, "1", "2")).to.eql([0, 0]);
    });

    it("returns 1 for present members and 0 for absent ones", async function () {
      if (await isRedisVersionLowerThan("6.2.0")) {
        return this.skip();
      }

      const key = `smismember:${Date.now()}`;
      await redis.sadd(key, ["a", "b"]);

      expect(await redis.smismember(key, "a", "c", "b")).to.eql([1, 0, 1]);
    });
  });
}
