import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`ttl (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns -2 when the key does not exist", async () => {
      const key = `ttl:${Date.now()}`;

      expect(await redis.ttl(key)).to.equal(-2);
    });

    it("returns -1 when the key has no expiration", async () => {
      const key = `ttl:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.ttl(key)).to.equal(-1);
    });

    it("returns the remaining time to live in seconds", async () => {
      const key = `ttl:${Date.now()}`;
      await redis.set(key, "value", "EX", 60);

      expect(await redis.ttl(key)).to.be.greaterThan(0);
    });
  });
}
