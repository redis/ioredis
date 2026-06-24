import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";
import { toRecord } from "../../helpers/util";

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

      const info = await redis.xinfo("STREAM", key);
      const record = Array.isArray(info)
        ? toRecord(info as unknown[])
        : (info as Record<string, unknown>);
      const actual = {
        isArray: Array.isArray(info),
        length: record.length,
        lastGeneratedId: record["last-generated-id"],
      };
      const expected: Record<ReplyMapping, unknown> = {
        legacy: { isArray: true, length: 1, lastGeneratedId: "1-1" },
        resp3: { isArray: false, length: 1, lastGeneratedId: "1-1" },
      };

      expect(actual).to.deep.equal(expected[opts.replyMapping]);
    });

    it("GROUPS reports the consumer groups", async () => {
      const key = `xinfo:${Date.now()}`;
      const group = "group";
      await redis.xadd(key, "1-1", "field", "value");
      await redis.xgroup("CREATE", key, group, "0");

      const groups = (await redis.xinfo("GROUPS", key)) as unknown[];
      expect(groups).to.have.lengthOf(1);
      const record = Array.isArray(groups[0])
        ? toRecord(groups[0] as unknown[])
        : (groups[0] as Record<string, unknown>);
      const actual = {
        isArray: Array.isArray(groups[0]),
        name: record.name,
        consumers: record.consumers,
        pending: record.pending,
      };
      const expected: Record<ReplyMapping, unknown> = {
        legacy: { isArray: true, name: group, consumers: 0, pending: 0 },
        resp3: { isArray: false, name: group, consumers: 0, pending: 0 },
      };

      expect(actual).to.deep.equal(expected[opts.replyMapping]);
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

      const consumers = (await redis.xinfo(
        "CONSUMERS",
        key,
        group
      )) as unknown[];
      expect(consumers).to.have.lengthOf(1);
      const record = Array.isArray(consumers[0])
        ? toRecord(consumers[0] as unknown[])
        : (consumers[0] as Record<string, unknown>);
      const actual = {
        isArray: Array.isArray(consumers[0]),
        name: record.name,
        pending: record.pending,
      };
      const expected: Record<ReplyMapping, unknown> = {
        legacy: { isArray: true, name: consumer, pending: 1 },
        resp3: { isArray: false, name: consumer, pending: 1 },
      };

      expect(actual).to.deep.equal(expected[opts.replyMapping]);
    });
  });
}
