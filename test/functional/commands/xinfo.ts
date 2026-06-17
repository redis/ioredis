import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { toRecord } from "../../helpers/util";

// XINFO STREAM / XINFO GROUPS are RESP3 map replies: a flat [k, v, ...] array
// under legacy mapping (configs A/B) and a plain object under resp3 (config C).
// `toRecord` normalizes the flat-array form; objects are read as-is. This lets
// the happy-path assertions index documented fields by name across all configs
// without an `if`/ternary on the reply mapping (XINFO is not a declared
// divergent command in returnTypes.js).
function asRecord(reply: unknown): Record<string, unknown> {
  if (Array.isArray(reply)) {
    return toRecord(reply);
  }
  return reply as Record<string, unknown>;
}

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xinfo (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("STREAM reports the stream metadata", async () => {
      const key = `xinfo:${Date.now()}`;
      await redis.xadd(key, "1-1", "field", "value");

      const info = asRecord(await redis.xinfo("STREAM", key));
      expect(Number(info.length)).to.equal(1);
      expect(info["last-generated-id"]).to.equal("1-1");
    });

    it("GROUPS reports the consumer groups", async () => {
      const key = `xinfo:${Date.now()}`;
      const group = "group";
      await redis.xadd(key, "1-1", "field", "value");
      await redis.xgroup("CREATE", key, group, "0");

      const groups = (await redis.xinfo("GROUPS", key)) as unknown[];
      expect(groups).to.have.lengthOf(1);

      const groupInfo = asRecord(groups[0]);
      expect(groupInfo.name).to.equal(group);
      expect(Number(groupInfo.consumers)).to.equal(0);
      expect(Number(groupInfo.pending)).to.equal(0);
    });

    it("CONSUMERS reports the consumers in a group", async () => {
      const key = `xinfo:${Date.now()}`;
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

      const consumers = (await redis.xinfo("CONSUMERS", key, group)) as unknown[];
      expect(consumers).to.have.lengthOf(1);

      const consumerInfo = asRecord(consumers[0]);
      expect(consumerInfo.name).to.equal(consumer);
      expect(Number(consumerInfo.pending)).to.equal(1);
    });
  });
}
