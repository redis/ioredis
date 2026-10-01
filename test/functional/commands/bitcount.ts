import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`bitcount (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing key", async () => {
      const key = `bitcount:${Date.now()}`;

      expect(await redis.bitcount(key)).to.equal(0);
    });

    it("returns the number of set bits", async () => {
      const key = `bitcount:${Date.now()}`;
      await redis.set(key, "foobar");

      expect(await redis.bitcount(key)).to.equal(26);
    });
  });
}
