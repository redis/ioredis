import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xautoclaim (${name})`, () => {
    let redis: Redis;

    beforeEach(async function () {
      // XAUTOCLAIM was introduced in Redis 6.2.
      if (await isRedisVersionLowerThan("7.0")) {
        this.skip();
      }
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      if (redis) {
        redis.disconnect();
      }
    });

    it("returns [cursor, claimed entries, deleted ids]", async () => {
      const key = `xautoclaim:${Date.now()}`;
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

      // Redis 7.0+ reply: [nextCursor, [[id, fields], ...], [deletedIds]].
      expect(
        await redis.xautoclaim(key, group, "consumer-2", 0, "0-0")
      ).to.eql(["0-0", [["1-1", ["field", "value"]]], []]);
    });
  });
}
