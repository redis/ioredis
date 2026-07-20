import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lset (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns OK after setting the element", async () => {
      const key = `lset:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.lset(key, 1, "B")).to.equal("OK");
      expect(await redis.lrange(key, 0, -1)).to.eql(["a", "B", "c"]);
    });
  });
}
