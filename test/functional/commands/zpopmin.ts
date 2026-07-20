import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zpopmin (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("pops the member with the lowest score", async () => {
      const key = `zpopmin:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["a", "1"],
        resp3: ["a", 1],
      };

      expect(await redis.zpopmin(key)).to.eql(expected[opts.replyMapping]);
    });

    it("pops multiple members with a count", async () => {
      const key = `zpopmin:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["a", "1", "b", "2"],
        resp3: [
          ["a", 1],
          ["b", 2],
        ],
      };

      expect(await redis.zpopmin(key, 2)).to.eql(expected[opts.replyMapping]);
    });
  });
}
