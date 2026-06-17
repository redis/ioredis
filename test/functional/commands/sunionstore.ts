import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sunionstore (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when there is nothing to store", async () => {
      const dest = `sunionstore:${Date.now()}:dest`;
      const key = `sunionstore:${Date.now()}:key`;

      expect(await redis.sunionstore(dest, key)).to.equal(0);
    });

    it("stores the union and returns its cardinality", async () => {
      const dest = `sunionstore:${Date.now()}:dest`;
      const key1 = `sunionstore:${Date.now()}:1`;
      const key2 = `sunionstore:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c"]);
      await redis.sadd(key2, ["c", "d", "e"]);

      expect(await redis.sunionstore(dest, key1, key2)).to.equal(5);
    });
  });
}
