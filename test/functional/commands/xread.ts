import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";
import {
  countStreamEntries,
  isRedisVersionLowerThan,
} from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xread (${name})`, () => {
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
        const first = `xread:first:${Date.now()}`;
        const second = `xread:second:${Date.now()}`;

        await redis.xadd(first, "1-1", "field", "first-1");
        await redis.xadd(first, "1-2", "field", "first-2");
        await redis.xadd(second, "1-1", "field", "second-1");
        await redis.xadd(second, "1-2", "field", "second-2");

        return { first, second };
      }

      it("limits the cumulative entry count across streams", async () => {
        const { first, second } = await seedStreams();

        const reply = await redis.xread(
          "MAXCOUNT",
          3,
          "STREAMS",
          first,
          second,
          "0-0",
          "0-0"
        );

        expect(countStreamEntries(reply)).to.equal(3);
      });

      it("limits the cumulative reply size while returning one entry", async () => {
        const { first, second } = await seedStreams();

        const reply = await redis.xread(
          "MAXSIZE",
          1,
          "STREAMS",
          first,
          second,
          "0-0",
          "0-0"
        );

        expect(countStreamEntries(reply)).to.equal(1);
      });
    });

    it("returns null when there is nothing to read", async () => {
      const key = `xread:${Date.now()}`;
      await redis.xadd(key, "1-1", "field", "value");

      expect(await redis.xread("STREAMS", key, "$")).to.equal(null);
    });

    it("returns the stream entries keyed by stream name", async () => {
      const key = `xread:${Date.now()}`;
      await redis.xadd(key, "1-1", "field", "value");

      const expected: Record<ReplyMapping, unknown> = {
        // RESP2 and RESP3/legacy both surface the classic array-of-pairs shape.
        legacy: [[key, [["1-1", ["field", "value"]]]]],
        // Native RESP3 keeps the stream map as a plain object.
        resp3: { [key]: [["1-1", ["field", "value"]]] },
      };

      expect(await redis.xread("STREAMS", key, "0-0")).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
