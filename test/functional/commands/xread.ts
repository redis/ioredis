import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xread (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null when there is nothing to read", async () => {
      const key = `xread:${Date.now()}`;
      await redis.xadd(key, "1-1", "field", "value");

      expect(await redis.xread("STREAMS", key, "$")).to.equal(null);
    });

    it("returns the stream entries keyed by stream name", async () => {
      const key = `xread:${Date.now()}`;
      await redis.xadd(key, "1-1", "field", "value");

      const expected: Record<ReplyMapping, unknown> = {
        // RESP2 and RESP3/legacy both surface the classic array-of-pairs shape.
        legacy: [[key, [["1-1", ["field", "value"]]]]],
        // Native RESP3 keeps the stream map as a plain object.
        resp3: { [key]: [["1-1", ["field", "value"]]] },
      };

      expect(await redis.xread("STREAMS", key, "0-0")).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
