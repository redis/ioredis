import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hsetnx (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 1 when the field is set", async () => {
      const key = `hsetnx:${Date.now()}`;

      expect(await redis.hsetnx(key, "field", "value")).to.equal(1);
    });

    it("returns 0 when the field already exists", async () => {
      const key = `hsetnx:${Date.now()}`;
      await redis.hset(key, "field", "value");

      expect(await redis.hsetnx(key, "field", "other")).to.equal(0);
    });
  });
}
