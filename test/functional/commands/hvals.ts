import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hvals (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing key", async () => {
      const key = `hvals:${Date.now()}`;

      expect(await redis.hvals(key)).to.eql([]);
    });

    it("returns all field values", async () => {
      const key = `hvals:${Date.now()}`;
      await redis.hset(key, "field1", "value1", "field2", "value2", "field3", "value3");

      expect((await redis.hvals(key)).sort()).to.eql([
        "value1",
        "value2",
        "value3",
      ]);
    });
  });
}
