import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lpos (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("6.0.6")) {
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

    it("returns null when the element is not present", async () => {
      const key = `lpos:${Date.now()}`;

      expect(await redis.lpos(key, "element")).to.equal(null);
    });

    it("returns the index of the matching element", async () => {
      const key = `lpos:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c", "b");

      expect(await redis.lpos(key, "b")).to.equal(1);
    });

    it("returns an array of indexes with COUNT", async () => {
      const key = `lpos:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c", "b");

      expect(await redis.lpos(key, "b", "COUNT", 0)).to.eql([1, 3]);
    });
  });
}
