import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sismember (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the member is not in the set", async () => {
      const key = `sismember:${Date.now()}`;

      expect(await redis.sismember(key, "member")).to.equal(0);
    });

    it("returns 1 when the member is in the set", async () => {
      const key = `sismember:${Date.now()}`;
      await redis.sadd(key, "member");

      expect(await redis.sismember(key, "member")).to.equal(1);
    });
  });
}
