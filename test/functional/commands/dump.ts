import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`dump (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null when the key does not exist", async () => {
      const key = `dump:${Date.now()}`;

      expect(await redis.dump(key)).to.equal(null);
    });

    it("returns a non-empty serialized value", async () => {
      const key = `dump:${Date.now()}`;
      await redis.set(key, "value");

      const reply = await redis.dump(key);
      expect(reply).to.be.a("string");
      expect((reply as string).length).to.be.greaterThan(0);
    });
  });
}
