import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sort_ro (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("7.0.0")) {
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

    it("returns the sorted elements of a list", async () => {
      const key = `sort_ro:${Date.now()}`;
      await redis.rpush(key, "3", "1", "2");

      expect(await redis.sort_ro(key)).to.eql(["1", "2", "3"]);
    });

    it("sorts in descending order with DESC", async () => {
      const key = `sort_ro:${Date.now()}`;
      await redis.rpush(key, "1", "3", "2");

      expect(await redis.sort_ro(key, "DESC")).to.eql(["3", "2", "1"]);
    });
  });
}
