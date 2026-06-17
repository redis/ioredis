import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sdiffstore (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when there is nothing to store", async () => {
      const dest = `sdiffstore:${Date.now()}:dest`;
      const key = `sdiffstore:${Date.now()}:key`;

      expect(await redis.sdiffstore(dest, key)).to.equal(0);
    });

    it("stores the difference and returns its cardinality", async () => {
      const dest = `sdiffstore:${Date.now()}:dest`;
      const key1 = `sdiffstore:${Date.now()}:1`;
      const key2 = `sdiffstore:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c", "d"]);
      await redis.sadd(key2, ["c", "d"]);

      expect(await redis.sdiffstore(dest, key1, key2)).to.equal(2);
    });
  });
}
