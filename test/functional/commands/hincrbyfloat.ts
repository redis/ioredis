import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hincrbyfloat (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the incremented field value as a string", async () => {
      const key = `hincrbyfloat:${Date.now()}`;

      expect(await redis.hincrbyfloat(key, "field", 1.5)).to.equal("1.5");
    });
  });
}
