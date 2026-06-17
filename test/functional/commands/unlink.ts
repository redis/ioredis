import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`unlink (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the key does not exist", async () => {
      const key = `unlink:${Date.now()}`;

      expect(await redis.unlink(key)).to.equal(0);
    });

    it("returns the number of keys removed", async () => {
      const key = `unlink:${Date.now()}`;
      const key2 = `unlink:2:${Date.now()}`;
      await redis.set(key, "value");
      await redis.set(key2, "value");

      expect(await redis.unlink(key, key2)).to.equal(2);
    });
  });
}
