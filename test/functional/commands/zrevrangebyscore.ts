import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrevrangebyscore (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns members within the score range, reversed", async () => {
      const key = `zrevrangebyscore:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b", 3, "c");

      expect(await redis.zrevrangebyscore(key, 2, 1)).to.eql(["b", "a"]);
    });

    it("returns members WITHSCORES", async () => {
      const key = `zrevrangebyscore:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["b", "2", "a", "1"],
        resp3: [
          ["b", 2],
          ["a", 1],
        ],
      };

      expect(
        await redis.zrevrangebyscore(key, "+inf", "-inf", "WITHSCORES")
      ).to.eql(expected[opts.replyMapping]);
    });
  });
}
