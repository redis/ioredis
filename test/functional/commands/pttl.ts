import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`pttl (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns -2 when the key does not exist", async () => {
      const key = `pttl:${Date.now()}`;

      expect(await redis.pttl(key)).to.equal(-2);
    });

    it("returns -1 when the key has no expiration", async () => {
      const key = `pttl:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.pttl(key)).to.equal(-1);
    });

    it("returns the remaining time to live in milliseconds", async () => {
      const key = `pttl:${Date.now()}`;
      await redis.set(key, "value", "PX", 60000);

      expect(await redis.pttl(key)).to.be.greaterThan(0);
    });
  });
}
