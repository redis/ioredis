import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrange (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns members in the index range", async () => {
      const key = `zrange:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b", 3, "c");

      expect(await redis.zrange(key, 0, "1")).to.eql(["a", "b"]);
    });

    it("returns members WITHSCORES", async () => {
      const key = `zrange:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["a", "1", "b", "2"],
        resp3: [
          ["a", 1],
          ["b", 2],
        ],
      };

      expect(await redis.zrange(key, 0, "-1", "WITHSCORES")).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
