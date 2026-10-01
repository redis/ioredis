import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sdiff (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing set", async () => {
      const key = `sdiff:${Date.now()}`;

      expect(await redis.sdiff(key)).to.eql([]);
    });

    it("returns the members of the difference", async () => {
      const key1 = `sdiff:${Date.now()}:1`;
      const key2 = `sdiff:${Date.now()}:2`;
      const key3 = `sdiff:${Date.now()}:3`;
      await redis.sadd(key1, ["a", "b", "c", "d"]);
      await redis.sadd(key2, ["c"]);
      await redis.sadd(key3, ["a", "c", "e"]);

      const result = await redis.sdiff(key1, key2, key3);
      expect([...result].sort()).to.eql(["b", "d"]);
    });
  });
}
