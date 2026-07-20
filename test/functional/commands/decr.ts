import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`decr (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("decrements the value by one", async () => {
      const key = `decr:${Date.now()}`;

      expect(await redis.decr(key)).to.equal(-1);
      expect(await redis.decr(key)).to.equal(-2);
    });
  });
}
