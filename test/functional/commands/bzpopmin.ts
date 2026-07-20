import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`bzpopmin (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("pops the member with the lowest score", async () => {
      const key = `bzpopmin:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: [key, "a", "1"],
        resp3: [key, "a", 1],
      };

      expect(await redis.bzpopmin(key, 0.01)).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
