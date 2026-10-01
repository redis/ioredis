import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`rpushx (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing key", async () => {
      const key = `rpushx:${Date.now()}`;

      expect(await redis.rpushx(key, "element")).to.equal(0);
    });

    it("returns the new length when the list exists", async () => {
      const key = `rpushx:${Date.now()}`;
      await redis.rpush(key, "a");

      expect(await redis.rpushx(key, "b")).to.equal(2);
      expect(await redis.lrange(key, 0, -1)).to.eql(["a", "b"]);
    });
  });
}
