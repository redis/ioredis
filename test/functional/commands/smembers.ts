import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`smembers (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing set", async () => {
      const key = `smembers:${Date.now()}`;

      expect(await redis.smembers(key)).to.eql([]);
    });

    it("returns all members of the set", async () => {
      const key = `smembers:${Date.now()}`;
      await redis.sadd(key, ["a", "b", "c"]);

      const result = await redis.smembers(key);
      expect([...result].sort()).to.eql(["a", "b", "c"]);
    });
  });
}
