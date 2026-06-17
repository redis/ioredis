import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`keys (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array when no keys match", async () => {
      expect(await redis.keys(`keys:${Date.now()}:*`)).to.eql([]);
    });

    it("returns the matching keys", async () => {
      const prefix = `keys:${Date.now()}`;
      await redis.set(`${prefix}:a`, "value");
      await redis.set(`${prefix}:b`, "value");

      expect((await redis.keys(`${prefix}:*`)).sort()).to.eql([
        `${prefix}:a`,
        `${prefix}:b`,
      ]);
    });
  });
}
