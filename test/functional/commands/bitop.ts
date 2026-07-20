import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`bitop (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 for non-existing source keys", async () => {
      const dest = `bitop:dest:${Date.now()}`;
      const key1 = `bitop:1:${Date.now()}`;
      const key2 = `bitop:2:${Date.now()}`;

      expect(await redis.bitop("AND", dest, key1, key2)).to.equal(0);
    });

    it("returns the size of the resulting string", async () => {
      const dest = `bitop:dest:${Date.now()}`;
      const key1 = `bitop:1:${Date.now()}`;
      const key2 = `bitop:2:${Date.now()}`;
      await redis.set(key1, "value1");
      await redis.set(key2, "value2");

      expect(await redis.bitop("AND", dest, key1, key2)).to.equal(6);
    });
  });
}
