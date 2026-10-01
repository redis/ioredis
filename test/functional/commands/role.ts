import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`role (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("reports the master role", async () => {
      const reply = (await redis.role()) as unknown[];

      expect(reply).to.be.an("array");
      expect(reply[0]).to.equal("master");
    });
  });
}
