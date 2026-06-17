import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`strlen (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing key", async () => {
      const key = `strlen:${Date.now()}`;

      expect(await redis.strlen(key)).to.equal(0);
    });

    it("returns the length of the stored string", async () => {
      const key = `strlen:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.strlen(key)).to.equal(5);
    });
  });
}
