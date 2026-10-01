import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`getbit (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the bit value at the offset", async () => {
      const key = `getbit:${Date.now()}`;

      expect(await redis.getbit(key, 0)).to.equal(0);

      await redis.setbit(key, 0, 1);
      expect(await redis.getbit(key, 0)).to.equal(1);
    });
  });
}
