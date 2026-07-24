import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sunion (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing set", async () => {
      const key = `sunion:${Date.now()}`;

      expect(await redis.sunion(key)).to.eql([]);
    });

    it("returns the members of the union", async () => {
      const key1 = `sunion:${Date.now()}:1`;
      const key2 = `sunion:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c", "d"]);
      await redis.sadd(key2, ["c", "e"]);

      const result = await redis.sunion(key1, key2);
      expect([...result].sort()).to.eql(["a", "b", "c", "d", "e"]);
    });
  });
}
