import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`srem (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the member is not in the set", async () => {
      const key = `srem:${Date.now()}`;

      expect(await redis.srem(key, "member")).to.equal(0);
    });

    it("returns the number of removed members", async () => {
      const key = `srem:${Date.now()}`;
      await redis.sadd(key, ["member1", "member2", "member3"]);

      expect(await redis.srem(key, ["member1", "member2"])).to.equal(2);
    });
  });
}
