import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xreadgroup (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null when there are no new messages", async () => {
      const key = `xreadgroup:${Date.now()}`;
      const group = "group";
      await redis.xadd(key, "1-1", "field", "value");
      await redis.xgroup("CREATE", key, group, "$");

      expect(
        await redis.xreadgroup("GROUP", group, "consumer", "STREAMS", key, ">")
      ).to.equal(null);
    });

    it("returns the stream entries keyed by stream name", async () => {
      const key = `xreadgroup:${Date.now()}`;
      const group = "group";
      await redis.xadd(key, "1-1", "field", "value");
      await redis.xgroup("CREATE", key, group, "0");

      const expected: Record<ReplyMapping, unknown> = {
        // RESP2 and RESP3/legacy both surface the classic array-of-pairs shape.
        legacy: [[key, [["1-1", ["field", "value"]]]]],
        // Native RESP3 keeps the stream map as a plain object.
        resp3: { [key]: [["1-1", ["field", "value"]]] },
      };

      expect(
        await redis.xreadgroup("GROUP", group, "consumer", "STREAMS", key, ">")
      ).to.eql(expected[opts.replyMapping]);
    });
  });
}
