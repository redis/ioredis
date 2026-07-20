import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hkeys (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing key", async () => {
      const key = `hkeys:${Date.now()}`;

      expect(await redis.hkeys(key)).to.eql([]);
    });

    it("returns all field names", async () => {
      const key = `hkeys:${Date.now()}`;
      await redis.hset(key, "field1", "value1", "field2", "value2", "field3", "value3");

      expect((await redis.hkeys(key)).sort()).to.eql([
        "field1",
        "field2",
        "field3",
      ]);
    });
  });
}
