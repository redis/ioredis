import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`ltrim (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns OK for a missing key", async () => {
      const key = `ltrim:${Date.now()}`;

      expect(await redis.ltrim(key, 0, -1)).to.equal("OK");
    });

    it("returns OK and trims the list", async () => {
      const key = `ltrim:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c", "d");

      expect(await redis.ltrim(key, 1, 2)).to.equal("OK");
      expect(await redis.lrange(key, 0, -1)).to.eql(["b", "c"]);
    });
  });
}
