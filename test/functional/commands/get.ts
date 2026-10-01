import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`get (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing key", async () => {
      const key = `get:${Date.now()}`;

      expect(await redis.get(key)).to.equal(null);
    });

    it("returns the stored value", async () => {
      const key = `get:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.get(key)).to.equal("value");
    });
  });
}
