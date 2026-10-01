import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";
import {
  countStreamEntries,
  isRedisVersionLowerThan,
} from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xreadgroup (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    describe("MAXCOUNT and MAXSIZE", function () {
      before(async function () {
        if (await isRedisVersionLowerThan("8.10")) {
          this.skip();
        }
      });

      async function seedStreams() {
        const first = `xreadgroup:first:${Date.now()}`;
        const second = `xreadgroup:second:${Date.now()}`;
        const group = "group";

        await redis.xadd(first, "1-1", "field", "first-1");
        await redis.xadd(first, "1-2", "field", "first-2");
        await redis.xadd(second, "1-1", "field", "second-1");
        await redis.xadd(second, "1-2", "field", "second-2");
        await redis.xgroup("CREATE", first, group, "0");
        await redis.xgroup("CREATE", second, group, "0");

        return { first, second, group };
      }

      it("limits the cumulative entry count across streams", async () => {
        const { first, second, group } = await seedStreams();

        const reply = await redis.xreadgroup(
          "GROUP",
          group,
          "consumer",
          "MAXCOUNT",
          3,
          "STREAMS",
          first,
          second,
          ">",
          ">"
        );

        expect(countStreamEntries(reply)).to.equal(3);
      });

      it("limits the cumulative reply size while returning one entry", async () => {
        const { first, second, group } = await seedStreams();

        const reply = await redis.xreadgroup(
          "GROUP",
          group,
          "consumer",
          "MAXSIZE",
          1,
          "STREAMS",
          first,
          second,
          ">",
          ">"
        );

        expect(countStreamEntries(reply)).to.equal(1);
      });
    });

    it("returns null when there are no new messages", async () => {
      const key = `xreadgroup:${Date.now()}`;
      const group = "group";
      await redis.xadd(key, "1-1", "field", "value");
      await redis.xgroup("CREATE", key, group, "$");

      expect(
        await redis.xreadgroup("GROUP", group, "consumer", "STREAMS", key, ">")
      ).to.equal(null);
    });

    it("returns the stream entries keyed by stream name", async () => {
      const key = `xreadgroup:${Date.now()}`;
      const group = "group";
      await redis.xadd(key, "1-1", "field", "value");
      await redis.xgroup("CREATE", key, group, "0");

      const expected: Record<ReplyMapping, unknown> = {
        // RESP2 and RESP3/legacy both surface the classic array-of-pairs shape.
        legacy: [[key, [["1-1", ["field", "value"]]]]],
        // Native RESP3 keeps the stream map as a plain object.
        resp3: { [key]: [["1-1", ["field", "value"]]] },
      };

      expect(
        await redis.xreadgroup("GROUP", group, "consumer", "STREAMS", key, ">")
      ).to.eql(expected[opts.replyMapping]);
    });
  });
}
