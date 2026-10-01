import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`decrby (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("decrements the value by the given amount", async () => {
      const key = `decrby:${Date.now()}`;

      expect(await redis.decrby(key, 2)).to.equal(-2);
      expect(await redis.decrby(key, 3)).to.equal(-5);
    });
  });
}
