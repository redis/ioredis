import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`getex (${name})`, function () {
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
      const key = `getex:${Date.now()}`;

      expect(await redis.getex(key, "PERSIST")).to.equal(null);
    });

    it("returns the stored value", async () => {
      const key = `getex:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.getex(key)).to.equal("value");
    });
  });
}
