import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrevrange (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns members in reverse index order", async () => {
      const key = `zrevrange:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b", 3, "c");

      expect(await redis.zrevrange(key, 0, 1)).to.eql(["c", "b"]);
    });

    it("returns members WITHSCORES", async () => {
      const key = `zrevrange:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["b", "2", "a", "1"],
        resp3: [
          ["b", 2],
          ["a", 1],
        ],
      };

      expect(await redis.zrevrange(key, 0, -1, "WITHSCORES")).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
