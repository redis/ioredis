import Redis from "../../lib/Redis";
import { expect } from "chai";

describe("hpexpire", () => {
  const hashKey = "test_hash_key";
  const field = "test_field";

  it("should handle non-existing field", async () => {
    const redis = new Redis();

    const result = await redis.hpexpire(
      "non_existing_hash_key",
      60,
      "NX",
      "FIELDS",
      1,
      "non_existing_field"
    );

    expect(result).to.deep.equal([-2]);
  });

  it("should handle existing field", async () => {
    const redis = new Redis();

    await redis.hset(hashKey, field, "value");

    const result = await redis.hpexpire(hashKey, 60, "FIELDS", 1, field);

    expect(result).to.deep.equal([1]);
  });

  it("should return 0 when condition is not met", async () => {
    const redis = new Redis();

    await redis.hset(hashKey, field, "value");
    await redis.hpexpire(hashKey, 60, "FIELDS", 1, field); // Set initial expiry

    // Try to set expiry with NX when field already has expiry
    const result = await redis.hpexpire(hashKey, 120, "NX", "FIELDS", 1, field);

    expect(result).to.deep.equal([0]);
  });

  it("should return 2 when expiring field with 0 seconds", async () => {
    const redis = new Redis();

    await redis.hset(hashKey, field, "value");

    const result = await redis.hpexpire(hashKey, 0, "FIELDS", 1, field);

    expect(result).to.deep.equal([2]);
  });

  it("should expire multiple fields", async () => {
    const redis = new Redis();

    await redis.hset(hashKey, field, "value", "field2", "value2");

    const result = await redis.hpexpire(
      hashKey,
      60,
      "FIELDS",
      3,
      field,
      "field2",
      "non_existing_field"
    );

    expect(result).to.deep.equal([1, 1, -2]);
  });
});
