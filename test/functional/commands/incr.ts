import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`incr (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("increments the value by one", async () => {
      const key = `incr:${Date.now()}`;

      expect(await redis.incr(key)).to.equal(1);
      expect(await redis.incr(key)).to.equal(2);
    });
  });
}
