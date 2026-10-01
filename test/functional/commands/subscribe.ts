import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`subscribe (${name})`, () => {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      // Disconnecting tears down subscriber mode and restores a clean state.
      redis.disconnect();
    });

    it("returns the number of channels subscribed to", async () => {
      const channel = `subscribe:${Date.now()}`;

      expect(await redis.subscribe(channel)).to.equal(1);
      expect(await redis.subscribe(`${channel}:2`)).to.equal(2);
    });
  });
}
