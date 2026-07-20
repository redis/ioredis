import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`linsert (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for a missing key", async () => {
      const key = `linsert:${Date.now()}`;

      expect(await redis.linsert(key, "BEFORE", "pivot", "element")).to.equal(
        0
      );
    });

    it("returns the new length after inserting", async () => {
      const key = `linsert:${Date.now()}`;
      await redis.rpush(key, "a", "c");

      expect(await redis.linsert(key, "BEFORE", "c", "b")).to.equal(3);
      expect(await redis.lrange(key, 0, -1)).to.eql(["a", "b", "c"]);
    });
  });
}
