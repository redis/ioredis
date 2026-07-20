import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zdiff (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the difference between the sorted sets", async () => {
      const key = `zdiff:${Date.now()}`;
      const s1 = `${key}:s1`;
      const s2 = `${key}:s2`;
      await redis.zadd(s1, 1, "a", 2, "b", 3, "c");
      await redis.zadd(s2, 1, "a");

      expect(await redis.zdiff(2, s1, s2)).to.eql(["b", "c"]);
    });

    it("returns the difference WITHSCORES", async () => {
      const key = `zdiff:${Date.now()}`;
      const s1 = `${key}:s1`;
      const s2 = `${key}:s2`;
      await redis.zadd(s1, 1, "a", 2, "b");
      await redis.zadd(s2, 1, "a");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["b", "2"],
        resp3: [["b", 2]],
      };

      expect(await redis.zdiff(2, s1, s2, "WITHSCORES")).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
