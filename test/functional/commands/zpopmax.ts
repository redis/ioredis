import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zpopmax (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("pops the member with the highest score", async () => {
      const key = `zpopmax:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["b", "2"],
        resp3: ["b", 2],
      };

      expect(await redis.zpopmax(key)).to.eql(expected[opts.replyMapping]);
    });

    it("pops multiple members with a count", async () => {
      const key = `zpopmax:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["b", "2", "a", "1"],
        resp3: [
          ["b", 2],
          ["a", 1],
        ],
      };

      expect(await redis.zpopmax(key, 2)).to.eql(expected[opts.replyMapping]);
    });
  });
}
