import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xdel (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the entry does not exist", async () => {
      const key = `xdel:${Date.now()}`;

      expect(await redis.xdel(key, "0-0")).to.equal(0);
    });

    it("returns the number of entries deleted", async () => {
      const key = `xdel:${Date.now()}`;
      await redis.xadd(key, "1-1", "field", "value");

      expect(await redis.xdel(key, "1-1")).to.equal(1);
      expect(await redis.xlen(key)).to.equal(0);
    });
  });
}
