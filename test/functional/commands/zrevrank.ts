import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrevrank (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the reverse rank of the member", async () => {
      const key = `zrevrank:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b", 3, "c");

      expect(await redis.zrevrank(key, "b")).to.equal(1);
    });

    it("returns the reverse rank and score WITHSCORE", async () => {
      const key = `zrevrank:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2.5, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: [0, "2.5"],
        resp3: [0, 2.5],
      };

      expect(await redis.zrevrank(key, "b", "WITHSCORE")).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
