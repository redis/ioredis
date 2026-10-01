import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`geoadd (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the number of new members added", async () => {
      const key = `geoadd:${Date.now()}`;

      expect(await redis.geoadd(key, 1, 2, "member")).to.equal(1);
    });

    it("returns 0 when updating an existing member", async () => {
      const key = `geoadd:${Date.now()}`;
      await redis.geoadd(key, 1, 2, "member");

      expect(await redis.geoadd(key, 3, 4, "member")).to.equal(0);
    });
  });
}
