import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`getrange (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty string for a missing key", async () => {
      const key = `getrange:${Date.now()}`;

      expect(await redis.getrange(key, 0, -1)).to.equal("");
    });

    it("returns the requested substring", async () => {
      const key = `getrange:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.getrange(key, 0, -1)).to.equal("value");
    });
  });
}
