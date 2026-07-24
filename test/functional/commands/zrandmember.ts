import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zrandmember (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns a single random member", async () => {
      const key = `zrandmember:${Date.now()}`;
      await redis.zadd(key, 1, "a");

      expect(await redis.zrandmember(key)).to.equal("a");
    });

    it("returns members WITHSCORES", async () => {
      const key = `zrandmember:${Date.now()}`;
      await redis.zadd(key, 1.5, "a");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["a", "1.5"],
        resp3: [["a", 1.5]],
      };

      expect(await redis.zrandmember(key, 1, "WITHSCORES")).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
