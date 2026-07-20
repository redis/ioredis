import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`incrbyfloat (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("increments the value by the given float amount", async () => {
      const key = `incrbyfloat:${Date.now()}`;

      expect(await redis.incrbyfloat(key, 1.5)).to.equal("1.5");
      expect(await redis.incrbyfloat(key, 1.5)).to.equal("3");
    });
  });
}
