import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";

describe("zunion", function () {
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

    return { s1, s2, s3 };
  }

  it("supports AGGREGATE COUNT", async () => {
    const { s1, s2, s3 } = await seedSets("zunion-count-basic");

    const result = await redis.zunion(
      3,
      s1,
      s2,
      s3,
      "AGGREGATE",
      "COUNT",
      "WITHSCORES"
    );

    expect(result).to.eql(["bar", "2", "foo", "3"]);
  });

  it("supports AGGREGATE COUNT with WEIGHTS", async () => {
    const { s1, s2, s3 } = await seedSets("zunion-count-weights");

    const result = await redis.zunion(
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
    );

    expect(result).to.eql(["bar", "15", "foo", "18"]);
  });
});
