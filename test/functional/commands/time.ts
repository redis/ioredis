import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`time (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the unix time and microseconds", async () => {
      const reply = (await redis.time()) as unknown as string[];

      expect(reply).to.be.an("array");
      expect(reply).to.have.lengthOf(2);
      expect(reply[0]).to.match(/^\d+$/);
      expect(reply[1]).to.match(/^\d+$/);
    });
  });
}
