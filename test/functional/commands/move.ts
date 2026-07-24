import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`move (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the key does not exist", async () => {
      const key = `move:${Date.now()}`;

      expect(await redis.move(key, 1)).to.equal(0);
    });

    it("returns 1 when the key is moved to another database", async () => {
      const key = `move:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.move(key, 1)).to.equal(1);
      expect(await redis.exists(key)).to.equal(0);
    });
  });
}
