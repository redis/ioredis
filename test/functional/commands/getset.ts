import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`getset (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null when the key did not exist", async () => {
      const key = `getset:${Date.now()}`;

      expect(await redis.getset(key, "value")).to.equal(null);
      expect(await redis.get(key)).to.equal("value");
    });

    it("returns the old value and sets the new one", async () => {
      const key = `getset:${Date.now()}`;
      await redis.set(key, "old");

      expect(await redis.getset(key, "new")).to.equal("old");
      expect(await redis.get(key)).to.equal("new");
    });
  });
}
