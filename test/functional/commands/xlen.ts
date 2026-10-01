import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xlen (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing stream", async () => {
      const key = `xlen:${Date.now()}`;

      expect(await redis.xlen(key)).to.equal(0);
    });

    it("returns the number of entries in the stream", async () => {
      const key = `xlen:${Date.now()}`;
      await redis.xadd(key, "1-1", "field", "value");
      await redis.xadd(key, "2-1", "field", "value");

      expect(await redis.xlen(key)).to.equal(2);
    });
  });
}
