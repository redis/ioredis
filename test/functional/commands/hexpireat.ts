import Redis from "../../../lib/Redis";
import { expect } from "chai";

describe("hexpireat", () => {
  const hashKey = "test_hash_key";
  const field = "test_field";

  it("should handle non-existing field", async () => {
    const redis = new Redis();
    const expiresAt = Math.floor(Date.now() / 1000) + 60;

    const result = await redis.hexpireat(
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
    const expiresAt = Math.floor(Date.now() / 1000) + 60;

    await redis.hset(hashKey, field, "value");

    const result = await redis.hexpireat(hashKey, expiresAt, "FIELDS", 1, field);

    expect(result).to.deep.equal([1]);
  });

  it("should return 0 when condition is not met", async () => {
    const redis = new Redis();
    const initialExpiresAt = Math.floor(Date.now() / 1000) + 60;
    const nextExpiresAt = Math.floor(Date.now() / 1000) + 120;

    await redis.hset(hashKey, field, "value");
    await redis.hexpireat(hashKey, initialExpiresAt, "FIELDS", 1, field);

    const result = await redis.hexpireat(
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

    const result = await redis.hexpireat(hashKey, 0, "FIELDS", 1, field);

    expect(result).to.deep.equal([2]);
  });

  it("should expire multiple fields", async () => {
    const redis = new Redis();
    const expiresAt = Math.floor(Date.now() / 1000) + 60;

    await redis.hset(hashKey, field, "value", "field2", "value2");

    const result = await redis.hexpireat(
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
