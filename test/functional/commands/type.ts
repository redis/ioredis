import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`type (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 'none' when the key does not exist", async () => {
      const key = `type:${Date.now()}`;

      expect(await redis.type(key)).to.equal("none");
    });

    it("returns the type of the value stored at the key", async () => {
      const key = `type:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.type(key)).to.equal("string");
    });
  });
}
