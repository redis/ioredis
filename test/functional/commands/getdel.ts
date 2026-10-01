import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`getdel (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("6.2")) {
        this.skip();
      }
    });

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing key", async () => {
      const key = `getdel:${Date.now()}`;

      expect(await redis.getdel(key)).to.equal(null);
    });

    it("returns the value and deletes the key", async () => {
      const key = `getdel:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.getdel(key)).to.equal("value");
      expect(await redis.get(key)).to.equal(null);
    });
  });
}
