import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`georadius (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing key", async () => {
      const key = `georadius:${Date.now()}`;

      expect(await redis.georadius(key, 1, 2, 3, "m")).to.eql([]);
    });

    it("returns members within the radius", async () => {
      const key = `georadius:${Date.now()}`;
      await redis.geoadd(key, 1, 2, "member");

      expect(await redis.georadius(key, 1, 2, 1, "m")).to.eql(["member"]);
    });
  });
}
