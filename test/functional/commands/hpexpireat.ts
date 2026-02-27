import Redis from "../../../lib/Redis";
import { expect } from "chai";

describe("hpexpireat", () => {
  const hashKey = "test_hash_key";
  const field = "test_field";

  it("should handle non-existing field", async () => {
    const redis = new Redis();
    const expiresAt = Date.now() + 60_000;

    const result = await redis.hpexpireat(
      "non_existing_hash_key",
      expiresAt,
      "NX",
      "FIELDS",
      1,
      "non_existing_field"
    );

    expect(result).to.deep.equal([-2]);
  });

  it("should handle existing field", async () => {
    const redis = new Redis();
    const expiresAt = Date.now() + 60_000;

    await redis.hset(hashKey, field, "value");

    const result = await redis.hpexpireat(hashKey, expiresAt, "FIELDS", 1, field);

    expect(result).to.deep.equal([1]);
  });

  it("should return 0 when condition is not met", async () => {
    const redis = new Redis();
    const initialExpiresAt = Date.now() + 60_000;
    const nextExpiresAt = Date.now() + 120_000;

    await redis.hset(hashKey, field, "value");
    await redis.hpexpireat(hashKey, initialExpiresAt, "FIELDS", 1, field);

    const result = await redis.hpexpireat(
      hashKey,
      nextExpiresAt,
      "NX",
      "FIELDS",
      1,
      field
    );

    expect(result).to.deep.equal([0]);
  });

  it("should return 2 when expiring field with 0 unix time", async () => {
    const redis = new Redis();

    await redis.hset(hashKey, field, "value");

    const result = await redis.hpexpireat(hashKey, 0, "FIELDS", 1, field);

    expect(result).to.deep.equal([2]);
  });

  it("should expire multiple fields", async () => {
    const redis = new Redis();
    const expiresAt = Date.now() + 60_000;

    await redis.hset(hashKey, field, "value", "field2", "value2");

    const result = await redis.hpexpireat(
      hashKey,
      expiresAt,
      "FIELDS",
      3,
      field,
      "field2",
      "non_existing_field"
    );

    expect(result).to.deep.equal([1, 1, -2]);
  });
});

