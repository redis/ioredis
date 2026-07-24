import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`psubscribe (${name})`, () => {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the number of patterns subscribed to", async () => {
      const pattern = `psubscribe:${Date.now()}:*`;

      expect(await redis.psubscribe(pattern)).to.equal(1);
      expect(await redis.psubscribe(`${pattern}:2`)).to.equal(2);
    });
  });
}
