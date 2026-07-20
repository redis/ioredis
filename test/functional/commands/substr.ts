import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`substr (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty string for a missing key", async () => {
      const key = `substr:${Date.now()}`;

      expect(await redis.substr(key, 0, -1)).to.equal("");
    });

    it("returns the requested substring", async () => {
      const key = `substr:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.substr(key, 0, -1)).to.equal("value");
    });
  });
}
