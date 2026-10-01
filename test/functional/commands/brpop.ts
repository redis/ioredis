import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`brpop (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null when the timeout elapses", async () => {
      const key = `brpop:${Date.now()}`;

      expect(await redis.brpop(key, 0.001)).to.equal(null);
    });

    it("returns the key and popped element", async () => {
      const key = `brpop:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.brpop(key, 0.001)).to.eql([key, "c"]);
    });
  });
}
