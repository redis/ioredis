import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`dbsize (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the number of keys in the database", async () => {
      expect(await redis.dbsize()).to.equal(0);

      await redis.set(`dbsize:${Date.now()}`, "value");

      expect(await redis.dbsize()).to.equal(1);
    });
  });
}
