import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`geosearch (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("6.2")) {
        this.skip();
      }
    });

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing key", async () => {
      const key = `geosearch:${Date.now()}`;

      expect(
        await redis.geosearch(key, "FROMLONLAT", 0, 0, "BYRADIUS", 1, "m")
      ).to.eql([]);
    });

    it("returns members within the search area", async () => {
      const key = `geosearch:${Date.now()}`;
      await redis.geoadd(key, 0, 0, "member");

      expect(
        await redis.geosearch(key, "FROMLONLAT", 0, 0, "BYRADIUS", 1, "m")
      ).to.eql(["member"]);
    });
  });
}
