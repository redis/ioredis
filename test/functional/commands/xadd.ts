import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xadd (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the generated entry id as a string", async () => {
      const key = `xadd:${Date.now()}`;

      const id = await redis.xadd(key, "*", "field", "value");
      expect(id).to.be.a("string");
      expect(await redis.xlen(key)).to.equal(1);
    });

    it("returns the explicit entry id", async () => {
      const key = `xadd:${Date.now()}`;

      expect(await redis.xadd(key, "1-1", "field", "value")).to.equal("1-1");
    });
  });
}
