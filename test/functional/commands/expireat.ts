import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`expireat (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the key does not exist", async () => {
      const key = `expireat:${Date.now()}`;

      expect(await redis.expireat(key, 1)).to.equal(0);
    });

    it("returns 1 when the timeout is set", async () => {
      const key = `expireat:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.expireat(key, 1893456000)).to.equal(1);
      expect(await redis.ttl(key)).to.be.greaterThan(0);
    });
  });
}
