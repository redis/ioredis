import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sinterstore (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when there is nothing to store", async () => {
      const dest = `sinterstore:${Date.now()}:dest`;
      const key = `sinterstore:${Date.now()}:key`;

      expect(await redis.sinterstore(dest, key)).to.equal(0);
    });

    it("stores the intersection and returns its cardinality", async () => {
      const dest = `sinterstore:${Date.now()}:dest`;
      const key1 = `sinterstore:${Date.now()}:1`;
      const key2 = `sinterstore:${Date.now()}:2`;
      const key3 = `sinterstore:${Date.now()}:3`;
      await redis.sadd(key1, ["a", "b", "c"]);
      await redis.sadd(key2, ["b", "c", "d"]);
      await redis.sadd(key3, ["c", "d", "e"]);

      expect(await redis.sinterstore(dest, key1, key2, key3)).to.equal(1);
    });
  });
}
