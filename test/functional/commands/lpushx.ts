import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lpushx (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing key", async () => {
      const key = `lpushx:${Date.now()}`;

      expect(await redis.lpushx(key, "element")).to.equal(0);
    });

    it("returns the new length when the list exists", async () => {
      const key = `lpushx:${Date.now()}`;
      await redis.lpush(key, "a");

      expect(await redis.lpushx(key, "b")).to.equal(2);
      expect(await redis.lrange(key, 0, -1)).to.eql(["b", "a"]);
    });
  });
}
