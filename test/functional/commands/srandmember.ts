import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`srandmember (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing set", async () => {
      const key = `srandmember:${Date.now()}`;

      expect(await redis.srandmember(key)).to.equal(null);
    });

    it("returns a random member of the set", async () => {
      const key = `srandmember:${Date.now()}`;
      await redis.sadd(key, "member");

      expect(await redis.srandmember(key)).to.equal("member");
    });

    it("returns the requested count of members", async () => {
      const key = `srandmember:${Date.now()}`;
      await redis.sadd(key, ["a", "b", "c"]);

      const result = await redis.srandmember(key, 3);
      expect([...result].sort()).to.eql(["a", "b", "c"]);
    });
  });
}
