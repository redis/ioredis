import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sadd (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the number of newly added members", async () => {
      const key = `sadd:${Date.now()}`;

      expect(await redis.sadd(key, "member")).to.equal(1);
      expect(await redis.sadd(key, ["a", "b"])).to.equal(2);
    });
  });
}
