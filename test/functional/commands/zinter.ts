import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zinter (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    async function seedSets(prefix: string) {
      const s1 = `${prefix}:s1`;
      const s2 = `${prefix}:s2`;
      const s3 = `${prefix}:s3`;

      await redis.zadd(s1, 1, "foo", 1, "bar");
      await redis.zadd(s2, 2, "foo", 2, "bar");
      await redis.zadd(s3, 3, "foo");

      return { s1, s2, s3 };
    }

    it("returns the intersection", async () => {
      const { s1, s2 } = await seedSets(`zinter-basic:${Date.now()}`);

      expect(await redis.zinter(2, s1, s2)).to.eql(["bar", "foo"]);
    });

    it("returns the intersection WITHSCORES", async () => {
      const { s1, s2 } = await seedSets(`zinter-withscores:${Date.now()}`);

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["bar", "3", "foo", "3"],
        resp3: [
          ["bar", 3],
          ["foo", 3],
        ],
      };

      expect(await redis.zinter(2, s1, s2, "WITHSCORES")).to.eql(
        expected[opts.replyMapping]
      );
    });

    describe("AGGREGATE COUNT", function () {
      before(async function () {
        if (await isRedisVersionLowerThan("8.7")) {
          this.skip();
        }
      });

      it("supports AGGREGATE COUNT", async () => {
        const { s1, s2, s3 } = await seedSets(
          `zinter-count-basic:${Date.now()}`
        );

        const expected: Record<ReplyMapping, unknown> = {
          legacy: ["foo", "3"],
          resp3: [["foo", 3]],
        };

        expect(
          await redis.zinter(3, s1, s2, s3, "AGGREGATE", "COUNT", "WITHSCORES")
        ).to.eql(expected[opts.replyMapping]);
      });

      it("supports AGGREGATE COUNT with WEIGHTS", async () => {
        const { s1, s2, s3 } = await seedSets(
          `zinter-count-weights:${Date.now()}`
        );

        const expected: Record<ReplyMapping, unknown> = {
          legacy: ["foo", "18"],
          resp3: [["foo", 18]],
        };

        expect(
          await redis.zinter(
            3,
            s1,
            s2,
            s3,
            "WEIGHTS",
            10,
            5,
            3,
            "AGGREGATE",
            "COUNT",
            "WITHSCORES"
          )
        ).to.eql(expected[opts.replyMapping]);
      });
    });
  });
}
