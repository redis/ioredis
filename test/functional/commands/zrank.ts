import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrank (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the rank of the member", async () => {
      const key = `zrank:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b", 3, "c");

      expect(await redis.zrank(key, "b")).to.equal(1);
    });

    it("returns the rank and score WITHSCORE", async () => {
      const key = `zrank:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2.5, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: [1, "2.5"],
        resp3: [1, 2.5],
      };

      expect(await redis.zrank(key, "b", "WITHSCORE")).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
