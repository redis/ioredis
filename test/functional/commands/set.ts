import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`set (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns OK when setting a value", async () => {
      const key = `set:${Date.now()}`;

      expect(await redis.set(key, "value")).to.equal("OK");
      expect(await redis.get(key)).to.equal("value");
    });
  });
}
