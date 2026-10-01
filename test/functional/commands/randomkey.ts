import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`randomkey (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null when the database is empty", async () => {
      expect(await redis.randomkey()).to.equal(null);
    });

    it("returns an existing key when the database has keys", async () => {
      const key = `randomkey:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.randomkey()).to.equal(key);
    });
  });
}
