import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lcs (${name})`, () => {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("7.0")) {
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

    it("returns an empty string when there is no common substring", async () => {
      const key = `lcs:a:${Date.now()}`;
      const key2 = `lcs:b:${Date.now()}`;

      expect(await redis.lcs(key, key2)).to.equal("");
    });

    it("returns the longest common substring", async () => {
      const key = `lcs:a:${Date.now()}`;
      const key2 = `lcs:b:${Date.now()}`;
      await redis.set(key, "ohmytext");
      await redis.set(key2, "mynewtext");

      expect(await redis.lcs(key, key2)).to.equal("mytext");
    });
  });
}
