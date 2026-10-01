import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`mget (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing key", async () => {
      const key = `mget:${Date.now()}`;

      expect(await redis.mget(key)).to.eql([null]);
    });

    it("returns the values for the requested keys", async () => {
      const ts = Date.now();
      const key1 = `mget:${ts}:1`;
      const key2 = `mget:${ts}:2`;
      await redis.set(key1, "value1");

      expect(await redis.mget(key1, key2)).to.eql(["value1", null]);
    });
  });
}
