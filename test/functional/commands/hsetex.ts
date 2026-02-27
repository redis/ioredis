import Redis from "../../../lib/Redis";
import { expect } from "chai";

// TODO unskip once we have a mechanism to run only on specific versions
// TODO as these tests can only work against 8.0 or higher
describe.skip("hsetex", () => {
  const hashKey = "test_hsetex_key";

  it("should return 1 when fields are set", async () => {
    const redis = new Redis();
    const key = `${hashKey}_${Date.now()}`;

    const result = await redis.hsetex(
      key,
      "FIELDS",
      2,
      "field1",
      "value1",
      "field2",
      "value2"
    );

    expect(result).to.equal(1);
  });

  it("should return 1 with FNX + EX when fields do not exist", async () => {
    const redis = new Redis();
    const key = `${hashKey}_fnx_ex_${Date.now()}`;

    const result = await redis.hsetex(
      key,
      "FNX",
      "EX",
      120,
      "FIELDS",
      2,
      "field1",
      "value1",
      "field2",
      "value2"
    );

    expect(result).to.equal(1);
  });

  it("should return 0 with FNX when any field already exists", async () => {
    const redis = new Redis();
    const key = `${hashKey}_fnx_${Date.now()}`;

    await redis.hset(key, "field1", "existing", "field2", "existing");
    const result = await redis.hsetex(
      key,
      "FNX",
      "FIELDS",
      2,
      "field1",
      "value1",
      "field2",
      "value2"
    );

    expect(result).to.equal(0);
  });

  it("should return 0 with FXX when not all fields exist", async () => {
    const redis = new Redis();
    const key = `${hashKey}_fxx_${Date.now()}`;

    await redis.hset(key, "field1", "existing");
    const result = await redis.hsetex(
      key,
      "FXX",
      "FIELDS",
      2,
      "field1",
      "value1",
      "field2",
      "value2"
    );

    expect(result).to.equal(0);
  });

  it("should return 1 with FXX + KEEPTTL when all fields exist", async () => {
    const redis = new Redis();
    const key = `${hashKey}_fxx_keepttl_${Date.now()}`;

    await redis.hset(key, "field1", "existing1", "field2", "existing2");
    await redis.hpexpire(key, 120_000, "FIELDS", 2, "field1", "field2");

    const result = await redis.hsetex(
      key,
      "FXX",
      "KEEPTTL",
      "FIELDS",
      2,
      "field1",
      "value1",
      "field2",
      "value2"
    );

    expect(result).to.equal(1);
  });

  it("should support PX option", async () => {
    const redis = new Redis();
    const key = `${hashKey}_px_${Date.now()}`;

    const result = await redis.hsetex(
      key,
      "PX",
      120_000,
      "FIELDS",
      1,
      "field1",
      "value1"
    );

    expect(result).to.equal(1);
  });

  it("should support EXAT option", async () => {
    const redis = new Redis();
    const key = `${hashKey}_exat_${Date.now()}`;
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 300;

    const result = await redis.hsetex(
      key,
      "EXAT",
      expiresAtSeconds,
      "FIELDS",
      1,
      "field1",
      "value1"
    );

    expect(result).to.equal(1);
  });

  it("should support PXAT option", async () => {
    const redis = new Redis();
    const key = `${hashKey}_pxat_${Date.now()}`;
    const expiresAtMilliseconds = Date.now() + 300_000;

    const result = await redis.hsetex(
      key,
      "PXAT",
      expiresAtMilliseconds,
      "FIELDS",
      1,
      "field1",
      "value1"
    );

    expect(result).to.equal(1);
  });

  it("should support KEEPTTL option", async () => {
    const redis = new Redis();
    const key = `${hashKey}_keepttl_${Date.now()}`;

    await redis.hsetex(key, "EX", 120, "FIELDS", 1, "field1", "value1");
    const result = await redis.hsetex(
      key,
      "KEEPTTL",
      "FIELDS",
      1,
      "field1",
      "value2"
    );

    expect(result).to.equal(1);
  });
});
