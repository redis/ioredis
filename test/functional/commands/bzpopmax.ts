import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`bzpopmax (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("pops the member with the highest score", async () => {
      const key = `bzpopmax:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: [key, "b", "2"],
        resp3: [key, "b", 2],
      };

      expect(await redis.bzpopmax(key, 0.01)).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
