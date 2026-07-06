import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`pexpiretime (${name})`, () => {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("7.0")) {
        this.skip();
      }
    });

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns -2 when the key does not exist", async () => {
      const key = `pexpiretime:${Date.now()}`;

      expect(await redis.pexpiretime(key)).to.equal(-2);
    });

    it("returns the absolute expiration time in milliseconds", async () => {
      const key = `pexpiretime:${Date.now()}`;
      const expireAt = Date.now() + 60_000;
      await redis.set(key, "value");
      await redis.pexpireat(key, expireAt);

      expect(await redis.pexpiretime(key)).to.equal(expireAt);
    });
  });
}
