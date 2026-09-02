import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isReCluster } from "../../helpers/re-config";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`select (${name})`, function () {
    let redis: Redis;

    before(function () {
      if (isReCluster()) {
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

    it("returns OK when switching database", async () => {
      expect(await redis.select(1)).to.equal("OK");
      expect(await redis.select(0)).to.equal("OK");
    });
  });
}
