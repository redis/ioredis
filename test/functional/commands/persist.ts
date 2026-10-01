import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`persist (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the key does not exist", async () => {
      const key = `persist:${Date.now()}`;

      expect(await redis.persist(key)).to.equal(0);
    });

    it("returns 1 when the timeout is removed", async () => {
      const key = `persist:${Date.now()}`;
      await redis.set(key, "value", "EX", 60);

      expect(await redis.persist(key)).to.equal(1);
      expect(await redis.ttl(key)).to.equal(-1);
    });
  });
}
