import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`geodist (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null when a member is missing", async () => {
      const key = `geodist:${Date.now()}`;

      expect(await redis.geodist(key, "1", "2")).to.equal(null);
    });

    it("returns the distance between two members", async () => {
      const key = `geodist:${Date.now()}`;
      await redis.geoadd(key, 1, 1, "1");
      await redis.geoadd(key, 2, 2, "2");

      // Documented node-redis spec value for these coordinates (meters).
      expect(await redis.geodist(key, "1", "2")).to.equal("157270.0561");
    });
  });
}
