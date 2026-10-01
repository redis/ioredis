import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`rpop (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing key", async () => {
      const key = `rpop:${Date.now()}`;

      expect(await redis.rpop(key)).to.equal(null);
    });

    it("returns the last element", async () => {
      const key = `rpop:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.rpop(key)).to.equal("c");
    });

    it("returns multiple elements with COUNT", async () => {
      const key = `rpop:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.rpop(key, 2)).to.eql(["c", "b"]);
    });
  });
}
