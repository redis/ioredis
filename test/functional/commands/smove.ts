import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`smove (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when the member is not in the source set", async () => {
      const source = `smove:${Date.now()}:src`;
      const dest = `smove:${Date.now()}:dst`;

      expect(await redis.smove(source, dest, "member")).to.equal(0);
    });

    it("returns 1 when the member is moved", async () => {
      const source = `smove:${Date.now()}:src`;
      const dest = `smove:${Date.now()}:dst`;
      await redis.sadd(source, "member");

      expect(await redis.smove(source, dest, "member")).to.equal(1);
      expect(await redis.sismember(dest, "member")).to.equal(1);
    });
  });
}
