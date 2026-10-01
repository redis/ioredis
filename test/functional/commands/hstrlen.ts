import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hstrlen (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing field", async () => {
      const key = `hstrlen:${Date.now()}`;

      expect(await redis.hstrlen(key, "field")).to.equal(0);
    });

    it("returns the length of the field value", async () => {
      const key = `hstrlen:${Date.now()}`;
      await redis.hset(key, "field", "value");

      expect(await redis.hstrlen(key, "field")).to.equal(5);
    });
  });
}
