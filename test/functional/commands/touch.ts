import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`touch (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the key does not exist", async () => {
      const key = `touch:${Date.now()}`;

      expect(await redis.touch(key)).to.equal(0);
    });

    it("returns the number of keys touched", async () => {
      const key = `touch:${Date.now()}`;
      const key2 = `touch:2:${Date.now()}`;
      await redis.set(key, "value");
      await redis.set(key2, "value");

      expect(await redis.touch(key, key2)).to.equal(2);
    });
  });
}
