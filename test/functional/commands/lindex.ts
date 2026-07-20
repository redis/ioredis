import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lindex (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing key", async () => {
      const key = `lindex:${Date.now()}`;

      expect(await redis.lindex(key, 0)).to.equal(null);
    });

    it("returns the element at the index", async () => {
      const key = `lindex:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.lindex(key, 0)).to.equal("a");
      expect(await redis.lindex(key, -1)).to.equal("c");
    });
  });
}
