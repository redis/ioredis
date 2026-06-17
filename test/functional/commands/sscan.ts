import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sscan (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the cursor and an empty element list for a missing set", async () => {
      const key = `sscan:${Date.now()}`;

      expect(await redis.sscan(key, 0)).to.eql(["0", []]);
    });

    it("returns the cursor and the set members", async () => {
      const key = `sscan:${Date.now()}`;
      await redis.sadd(key, ["a", "b", "c"]);

      const [cursor, elements] = await redis.sscan(key, 0);
      expect(cursor).to.equal("0");
      expect([...elements].sort()).to.eql(["a", "b", "c"]);
    });
  });
}
