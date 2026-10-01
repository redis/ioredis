import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`lpop (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing key", async () => {
      const key = `lpop:${Date.now()}`;

      expect(await redis.lpop(key)).to.equal(null);
    });

    it("returns the first element", async () => {
      const key = `lpop:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.lpop(key)).to.equal("a");
    });

    it("returns multiple elements with COUNT", async () => {
      const key = `lpop:${Date.now()}`;
      await redis.rpush(key, "a", "b", "c");

      expect(await redis.lpop(key, 2)).to.eql(["a", "b"]);
    });
  });
}
