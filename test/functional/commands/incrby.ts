import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`incrby (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("increments the value by the given amount", async () => {
      const key = `incrby:${Date.now()}`;

      expect(await redis.incrby(key, 1)).to.equal(1);
      expect(await redis.incrby(key, 4)).to.equal(5);
    });
  });
}
