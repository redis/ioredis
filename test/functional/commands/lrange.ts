import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lrange (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns an empty array for a missing key", async () => {
      const key = `lrange:${Date.now()}`;

      expect(await redis.lrange(key, 0, -1)).to.eql([]);
    });

    it("returns the requested range", async () => {
      const key = `lrange:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.lrange(key, 0, -1)).to.eql(["a", "b", "c"]);
      expect(await redis.lrange(key, 0, 1)).to.eql(["a", "b"]);
    });
  });
}
