import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zscore (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing member", async () => {
      const key = `zscore:${Date.now()}`;

      expect(await redis.zscore(key, "member")).to.equal(null);
    });

    it("returns the member score", async () => {
      const key = `zscore:${Date.now()}`;
      await redis.zadd(key, 1.5, "member");

      const expectedScore: Record<ReplyMapping, string | number> = {
        legacy: "1.5",
        resp3: 1.5,
      };

      expect(await redis.zscore(key, "member")).to.equal(
        expectedScore[opts.replyMapping]
      );
    });
  });
}
