import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`msetnx (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 1 when none of the keys exist", async () => {
      const ts = Date.now();
      const key1 = `msetnx:${ts}:1`;
      const key2 = `msetnx:${ts}:2`;

      expect(await redis.msetnx(key1, "value1", key2, "value2")).to.equal(1);
      expect(await redis.get(key1)).to.equal("value1");
      expect(await redis.get(key2)).to.equal("value2");
    });

    it("returns 0 when any key already exists", async () => {
      const ts = Date.now();
      const key1 = `msetnx:${ts}:1`;
      const key2 = `msetnx:${ts}:2`;
      await redis.set(key1, "existing");

      expect(await redis.msetnx(key1, "value1", key2, "value2")).to.equal(0);
      expect(await redis.get(key2)).to.equal(null);
    });
  });
}
