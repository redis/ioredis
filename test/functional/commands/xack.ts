import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xack (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 0 when nothing is acknowledged", async () => {
      const key = `xack:${Date.now()}`;
      await redis.xgroup("CREATE", key, "group", "$", "MKSTREAM");

      expect(await redis.xack(key, "group", "0-0")).to.equal(0);
    });

    it("returns the number of acknowledged entries", async () => {
      const key = `xack:${Date.now()}`;
      const group = "group";
      const consumer = "consumer";
      await redis.xadd(key, "1-1", "field", "value");
      await redis.xgroup("CREATE", key, group, "0");
      await redis.xreadgroup(
        "GROUP",
        group,
        consumer,
        "COUNT",
        1,
        "STREAMS",
        key,
        ">"
      );

      expect(await redis.xack(key, group, "1-1")).to.equal(1);
    });
  });
}
