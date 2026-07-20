import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`geosearchstore (${name})`, function () {
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

    it("returns 0 when the source key is missing", async () => {
      const source = `geosearchstore:source:${Date.now()}`;
      const dest = `geosearchstore:dest:${Date.now()}`;

      expect(
        await redis.geosearchstore(
          dest,
          source,
          "FROMLONLAT",
          0,
          0,
          "BYRADIUS",
          1,
          "m"
        )
      ).to.equal(0);
    });

    it("returns the number of stored members", async () => {
      const source = `geosearchstore:source:${Date.now()}`;
      const dest = `geosearchstore:dest:${Date.now()}`;
      await redis.geoadd(source, 0, 0, "member");

      expect(
        await redis.geosearchstore(
          dest,
          source,
          "FROMLONLAT",
          0,
          0,
          "BYRADIUS",
          1,
          "m"
        )
      ).to.equal(1);
    });
  });
}
