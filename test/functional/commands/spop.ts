import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`spop (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing set", async () => {
      const key = `spop:${Date.now()}`;

      expect(await redis.spop(key)).to.equal(null);
    });

    it("pops a member from the set", async () => {
      const key = `spop:${Date.now()}`;
      await redis.sadd(key, "member");

      expect(await redis.spop(key)).to.equal("member");
      expect(await redis.spop(key)).to.equal(null);
    });

    it("pops the requested count of members", async () => {
      const key = `spop:${Date.now()}`;
      await redis.sadd(key, ["a", "b", "c"]);

      const result = await redis.spop(key, 3);
      expect([...result].sort()).to.eql(["a", "b", "c"]);
    });
  });
}
