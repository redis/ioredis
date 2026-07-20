import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`del (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the key does not exist", async () => {
      const key = `del:${Date.now()}`;

      expect(await redis.del(key)).to.equal(0);
    });

    it("returns the number of keys removed", async () => {
      const key = `del:${Date.now()}`;
      const key2 = `del:2:${Date.now()}`;
      await redis.set(key, "value");
      await redis.set(key2, "value");

      expect(await redis.del(key, key2)).to.equal(2);
    });
  });
}
