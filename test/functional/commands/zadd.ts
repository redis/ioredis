import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zadd (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the number of members added", async () => {
      const key = `zadd:${Date.now()}`;

      expect(await redis.zadd(key, 1, "a", 2, "b")).to.equal(2);
    });

    it("returns the new score with INCR", async () => {
      const key = `zadd:${Date.now()}`;
      await redis.zadd(key, 1, "member");

      const expectedScore: Record<ReplyMapping, string | number> = {
        legacy: "2.5",
        resp3: 2.5,
      };

      expect(await redis.zadd(key, "INCR", 1.5, "member")).to.equal(
        expectedScore[opts.replyMapping]
      );
    });
  });
}
