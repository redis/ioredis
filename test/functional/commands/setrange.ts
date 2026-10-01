import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`setrange (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the new length of the string", async () => {
      const key = `setrange:${Date.now()}`;

      expect(await redis.setrange(key, 0, "value")).to.equal(5);
      expect(await redis.get(key)).to.equal("value");
    });
  });
}
