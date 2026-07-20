import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`setex (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns OK and stores the value with a TTL", async () => {
      const key = `setex:${Date.now()}`;

      expect(await redis.setex(key, 60, "value")).to.equal("OK");
      expect(await redis.get(key)).to.equal("value");
    });
  });
}
