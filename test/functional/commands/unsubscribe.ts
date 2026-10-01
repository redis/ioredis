import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`unsubscribe (${name})`, () => {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the remaining subscription count", async () => {
      const channel = `unsubscribe:${Date.now()}`;

      expect(await redis.subscribe(channel)).to.equal(1);
      expect(await redis.unsubscribe(channel)).to.equal(0);
    });
  });
}
