import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`geohash (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing member", async () => {
      const key = `geohash:${Date.now()}`;

      expect(await redis.geohash(key, "member")).to.eql([null]);
    });

    it("returns the geohash string for a member", async () => {
      const key = `geohash:${Date.now()}`;
      await redis.geoadd(key, 13.361389, 38.115556, "Palermo");

      // Documented geohash for these coordinates (11-char Redis geohash).
      expect(await redis.geohash(key, "Palermo")).to.eql(["sqc8b49rny0"]);
    });
  });
}
