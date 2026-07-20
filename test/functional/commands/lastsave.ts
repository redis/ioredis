import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lastsave (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the unix timestamp of the last save", async () => {
      const timestamp = await redis.lastsave();

      expect(timestamp).to.be.a("number");
      expect(timestamp).to.be.greaterThan(0);
    });
  });
}
