import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`llen (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing key", async () => {
      const key = `llen:${Date.now()}`;

      expect(await redis.llen(key)).to.equal(0);
    });

    it("returns the length of the list", async () => {
      const key = `llen:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.llen(key)).to.equal(3);
    });
  });
}
