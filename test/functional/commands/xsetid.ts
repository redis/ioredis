import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xsetid (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns OK after setting the last id", async () => {
      const key = `xsetid:${Date.now()}`;
      await redis.xadd(key, "1-1", "field", "value");

      expect(await redis.xsetid(key, "9999999999999-0")).to.equal("OK");
    });
  });
}
