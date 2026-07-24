import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sinter (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing set", async () => {
      const key = `sinter:${Date.now()}`;

      expect(await redis.sinter(key)).to.eql([]);
    });

    it("returns the members of the intersection", async () => {
      const key1 = `sinter:${Date.now()}:1`;
      const key2 = `sinter:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c"]);
      await redis.sadd(key2, ["b", "c", "d"]);

      const result = await redis.sinter(key1, key2);
      expect([...result].sort()).to.eql(["b", "c"]);
    });
  });
}
