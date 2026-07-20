import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`exists (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the key does not exist", async () => {
      const key = `exists:${Date.now()}`;

      expect(await redis.exists(key)).to.equal(0);
    });

    it("returns the count of existing keys", async () => {
      const key = `exists:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.exists(key)).to.equal(1);
      expect(await redis.exists(key, key)).to.equal(2);
    });
  });
}
