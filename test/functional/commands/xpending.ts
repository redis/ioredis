import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xpending (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the empty summary when nothing is pending", async () => {
      const key = `xpending:${Date.now()}`;
      await redis.xgroup("CREATE", key, "group", "$", "MKSTREAM");

      expect(await redis.xpending(key, "group")).to.eql([0, null, null, null]);
    });

    it("returns the summary with per-consumer counts", async () => {
      const key = `xpending:${Date.now()}`;
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

      expect(await redis.xpending(key, group)).to.eql([
        1,
        "1-1",
        "1-1",
        [[consumer, "1"]],
      ]);
    });
  });
}
