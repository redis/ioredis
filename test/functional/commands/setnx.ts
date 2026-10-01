import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`setnx (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 1 when the key did not exist", async () => {
      const key = `setnx:${Date.now()}`;

      expect(await redis.setnx(key, "value")).to.equal(1);
      expect(await redis.get(key)).to.equal("value");
    });

    it("returns 0 when the key already exists", async () => {
      const key = `setnx:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.setnx(key, "other")).to.equal(0);
      expect(await redis.get(key)).to.equal("value");
    });
  });
}
