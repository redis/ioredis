import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zincrby (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the new score of the member", async () => {
      const key = `zincrby:${Date.now()}`;
      await redis.zadd(key, 1, "member");

      const expectedScore: Record<ReplyMapping, string | number> = {
        legacy: "2.5",
        resp3: 2.5,
      };

      expect(await redis.zincrby(key, 1.5, "member")).to.equal(
        expectedScore[opts.replyMapping]
      );
    });
  });
}
