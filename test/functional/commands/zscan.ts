import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zscan (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the cursor and member/score pairs", async () => {
      const key = `zscan:${Date.now()}`;
      await redis.zadd(key, 1, "a");

      const [cursor, elements] = await redis.zscan(key, 0);

      expect(cursor).to.equal("0");
      expect(elements).to.eql(["a", "1"]);
    });
  });
}
