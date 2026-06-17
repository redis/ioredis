import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xrange (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing stream", async () => {
      const key = `xrange:${Date.now()}`;

      expect(await redis.xrange(key, "-", "+")).to.eql([]);
    });

    it("returns entries as [id, fields] pairs", async () => {
      const key = `xrange:${Date.now()}`;
      await redis.xadd(key, "1-1", "field", "value");

      expect(await redis.xrange(key, "-", "+")).to.eql([
        ["1-1", ["field", "value"]],
      ]);
    });
  });
}
