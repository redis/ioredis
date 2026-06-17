import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`zunionstore (${name})`, () => {
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

      return { s1, s2, s3, out: `${prefix}:out` };
    }

    it("stores the union and returns its cardinality", async () => {
      const { s1, s2, out } = await seedSets(`zunionstore-basic:${Date.now()}`);

      expect(await redis.zunionstore(out, 2, s1, s2)).to.equal(2);
      expect(await redis.zrange(out, 0, "-1")).to.eql(["bar", "foo"]);
    });

    describe("AGGREGATE COUNT", function () {
      before(async function () {
        if (await isRedisVersionLowerThan("8.7")) {
          this.skip();
        }
      });

      it("stores union counts with AGGREGATE COUNT", async () => {
        const { s1, s2, s3, out } = await seedSets(
          `zunionstore-count-basic:${Date.now()}`
        );

        expect(
          await redis.zunionstore(out, 3, s1, s2, s3, "AGGREGATE", "COUNT")
        ).to.equal(2);
        expect(await redis.zrange(out, 0, "-1")).to.eql(["bar", "foo"]);
      });

      it("stores weighted union counts with AGGREGATE COUNT", async () => {
        const { s1, s2, s3, out } = await seedSets(
          `zunionstore-count-weights:${Date.now()}`
        );

        expect(
          await redis.zunionstore(
            out,
            3,
            s1,
            s2,
            s3,
            "WEIGHTS",
            10,
            5,
            3,
            "AGGREGATE",
            "COUNT"
          )
        ).to.equal(2);
        expect(await redis.zrange(out, 0, "-1")).to.eql(["bar", "foo"]);
      });
    });
  });
}
