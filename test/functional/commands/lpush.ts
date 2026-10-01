import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lpush (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the new length of the list", async () => {
      const key = `lpush:${Date.now()}`;

      expect(await redis.lpush(key, "a")).to.equal(1);
      expect(await redis.lpush(key, "b", "c")).to.equal(3);
      expect(await redis.lrange(key, 0, -1)).to.eql(["c", "b", "a"]);
    });
  });
}
