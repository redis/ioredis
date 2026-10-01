import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`mset (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns OK and sets the given keys", async () => {
      const ts = Date.now();
      const key1 = `mset:${ts}:1`;
      const key2 = `mset:${ts}:2`;

      expect(await redis.mset(key1, "value1", key2, "value2")).to.equal("OK");
      expect(await redis.get(key1)).to.equal("value1");
      expect(await redis.get(key2)).to.equal("value2");
    });
  });
}
