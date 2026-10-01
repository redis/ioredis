import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`bzmpop (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("7.0")) {
        this.skip();
      }
    });

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("pops the member with the lowest score", async () => {
      const key = `bzmpop:${Date.now()}`;
      await redis.zadd(key, 1, "a", 2, "b");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: [key, [["a", "1"]]],
        resp3: [key, [["a", 1]]],
      };

      expect(await redis.bzmpop(0.01, 1, key, "MIN")).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
