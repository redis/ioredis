import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zmscore (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the scores of the given members", async () => {
      const key = `zmscore:${Date.now()}`;
      await redis.zadd(key, 1.5, "a", 2.5, "b");

      const expectedScores: Record<ReplyMapping, (string | number | null)[]> = {
        legacy: ["1.5", "2.5", null],
        resp3: [1.5, 2.5, null],
      };

      expect(await redis.zmscore(key, "a", "b", "c")).to.eql(
        expectedScores[opts.replyMapping]
      );
    });
  });
}
