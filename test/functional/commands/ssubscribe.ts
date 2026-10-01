import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`ssubscribe (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("7.0.0")) {
        this.skip();
      }
    });

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the number of shard channels subscribed to", async () => {
      const channel = `ssubscribe:${Date.now()}`;

      expect(await redis.ssubscribe(channel)).to.equal(1);
      expect(await redis.ssubscribe(`${channel}:2`)).to.equal(2);
    });
  });
}
