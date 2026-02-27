import Redis from "../../../lib/Redis";
import { expect } from "chai";

describe("hpersist", () => {
  const hashKey = "test_hpersist_key";
  const field = "test_field";

  it("should handle non-existing field", async () => {
    const redis = new Redis();

    const result = await redis.hpersist(
      "non_existing_hash_key",
      "FIELDS",
      1,
      "non_existing_field"
    );

    expect(result).to.deep.equal([-2]);
  });

  it("should return -1 for field without expiry", async () => {
    const redis = new Redis();

    await redis.hset(hashKey, field, "value");
    const result = await redis.hpersist(hashKey, "FIELDS", 1, field);

    expect(result).to.deep.equal([-1]);
  });

  it("should return 1 when removing field expiry", async () => {
    const redis = new Redis();
    const expiresAt = Math.floor(Date.now() / 1000) + 60;

    await redis.hset(hashKey, field, "value");
    await redis.hexpireat(hashKey, expiresAt, "FIELDS", 1, field);

    const result = await redis.hpersist(hashKey, "FIELDS", 1, field);

    expect(result).to.deep.equal([1]);
  });

  it("should return values for multiple fields", async () => {
    const redis = new Redis();
    const expiresAt = Math.floor(Date.now() / 1000) + 60;

    await redis.hset(hashKey, field, "value", "field2", "value2");
    await redis.hexpireat(hashKey, expiresAt, "FIELDS", 1, field);

    const result = await redis.hpersist(
      hashKey,
      "FIELDS",
      3,
      field,
      "field2",
      "non_existing_field"
    );

    expect(result).to.deep.equal([1, -1, -2]);
  });
});

