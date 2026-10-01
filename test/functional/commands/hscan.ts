import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hscan (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the cursor and field/value entries", async () => {
      const key = `hscan:${Date.now()}`;
      await redis.hset(key, "field", "value");

      expect(await redis.hscan(key, 0)).to.eql(["0", ["field", "value"]]);
    });
  });
}
