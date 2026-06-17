import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`scard (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing set", async () => {
      const key = `scard:${Date.now()}`;

      expect(await redis.scard(key)).to.equal(0);
    });

    it("returns the cardinality of the set", async () => {
      const key = `scard:${Date.now()}`;
      await redis.sadd(key, ["member1", "member2", "member3"]);

      expect(await redis.scard(key)).to.equal(3);
    });
  });
}
