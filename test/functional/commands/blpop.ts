import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`blpop (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null when the timeout elapses", async () => {
      const key = `blpop:${Date.now()}`;

      expect(await redis.blpop(key, 0.001)).to.equal(null);
    });

    it("returns the key and popped element", async () => {
      const key = `blpop:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.blpop(key, 0.001)).to.eql([key, "a"]);
    });
  });
}
