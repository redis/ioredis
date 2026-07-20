import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`setbit (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the original bit value at the offset", async () => {
      const key = `setbit:${Date.now()}`;

      expect(await redis.setbit(key, 0, 1)).to.equal(0);
      expect(await redis.setbit(key, 0, 0)).to.equal(1);
    });
  });
}
