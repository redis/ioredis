import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xrevrange (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing stream", async () => {
      const key = `xrevrange:${Date.now()}`;

      expect(await redis.xrevrange(key, "+", "-")).to.eql([]);
    });

    it("returns entries as [id, fields] pairs in reverse order", async () => {
      const key = `xrevrange:${Date.now()}`;
      await redis.xadd(key, "1-1", "field", "value");
      await redis.xadd(key, "2-1", "field", "value2");

      expect(await redis.xrevrange(key, "+", "-")).to.eql([
        ["2-1", ["field", "value2"]],
        ["1-1", ["field", "value"]],
      ]);
    });
  });
}
