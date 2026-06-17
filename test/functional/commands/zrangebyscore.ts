import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrangebyscore (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns members within the score range", async () => {
      const key = `zrangebyscore:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b", 3, "c");

      expect(await redis.zrangebyscore(key, 1, 2)).to.eql(["a", "b"]);
    });

    it("returns members WITHSCORES", async () => {
      const key = `zrangebyscore:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["a", "1", "b", "2"],
        resp3: [
          ["a", 1],
          ["b", 2],
        ],
      };

      expect(
        await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES")
      ).to.eql(expected[opts.replyMapping]);
    });
  });
}
