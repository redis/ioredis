import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";
import { isReCluster } from "../../helpers/re-config";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`config (${name})`, function () {
    let redis: Redis;

    before(function () {
      if (isReCluster()) {
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

    // CONFIG GET is a MAP reply: a flat [key, value, ...] array under the
    // legacy mapping, an object keyed by parameter under the native resp3 shape.
    it("GET returns the requested parameter", async () => {
      const expected: Record<ReplyMapping, string[] | Record<string, string>> =
        {
          legacy: ["maxmemory", "0"],
          resp3: { maxmemory: "0" },
        };

      expect(await redis.config("GET", "maxmemory")).to.eql(
        expected[opts.replyMapping]
      );
    });

    it("SET returns OK", async () => {
      expect(await redis.config("SET", "maxmemory", "0")).to.equal("OK");
    });

    it("RESETSTAT returns OK", async () => {
      expect(await redis.config("RESETSTAT")).to.equal("OK");
    });
  });
}
