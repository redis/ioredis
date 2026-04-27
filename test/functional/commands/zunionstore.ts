import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";

describe("zunionstore", function () {
  before(async function () {
    if (await isRedisVersionLowerThan("8.7")) {
      this.skip();
    }
  });

  let redis: Redis;

  beforeEach(() => {
    redis = new Redis();
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

  it("stores union counts with AGGREGATE COUNT", async () => {
    const { s1, s2, s3, out } = await seedSets("zunionstore-count-basic");

    const stored = await redis.zunionstore(
      out,
      3,
      s1,
      s2,
      s3,
      "AGGREGATE",
      "COUNT"
    );

    expect(stored).to.equal(2);
    expect(await redis.zrange(out, 0, -1, "WITHSCORES")).to.eql([
      "bar",
      "2",
      "foo",
      "3",
    ]);
  });

  it("stores weighted union counts with AGGREGATE COUNT", async () => {
    const { s1, s2, s3, out } = await seedSets("zunionstore-count-weights");

    const stored = await redis.zunionstore(
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
    );

    expect(stored).to.equal(2);
    expect(await redis.zrange(out, 0, -1, "WITHSCORES")).to.eql([
      "bar",
      "15",
      "foo",
      "18",
    ]);
  });
});
