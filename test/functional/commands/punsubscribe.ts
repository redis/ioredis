import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`punsubscribe (${name})`, () => {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the remaining pattern subscription count", async () => {
      const pattern = `punsubscribe:${Date.now()}:*`;

      expect(await redis.psubscribe(pattern)).to.equal(1);
      expect(await redis.punsubscribe(pattern)).to.equal(0);
    });
  });
}
