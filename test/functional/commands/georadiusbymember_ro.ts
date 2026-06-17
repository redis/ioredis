import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`georadiusbymember_ro (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the anchor member within a zero radius", async () => {
      const key = `georadiusbymember_ro:${Date.now()}`;
      await redis.geoadd(key, 1, 2, "anchor");

      expect(await redis.georadiusbymember_ro(key, "anchor", 0, "m")).to.eql([
        "anchor",
      ]);
    });

    it("returns members within the radius of a member", async () => {
      const key = `georadiusbymember_ro:${Date.now()}`;
      await redis.geoadd(key, 1, 2, "member");

      expect(await redis.georadiusbymember_ro(key, "member", 1, "m")).to.eql([
        "member",
      ]);
    });
  });
}
