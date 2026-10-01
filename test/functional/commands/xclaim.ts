import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xclaim (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("claims a pending entry and returns it as an [id, fields] pair", async () => {
      const key = `xclaim:${Date.now()}`;
      const group = "group";
      await redis.xadd(key, "1-1", "field", "value");
      await redis.xgroup("CREATE", key, group, "0");
      await redis.xreadgroup(
        "GROUP",
        group,
        "consumer-1",
        "COUNT",
        1,
        "STREAMS",
        key,
        ">"
      );

      expect(
        await redis.xclaim(key, group, "consumer-2", 0, "1-1")
      ).to.eql([["1-1", ["field", "value"]]]);
    });
  });
}
