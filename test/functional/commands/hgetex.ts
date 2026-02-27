import Redis from "../../../lib/Redis";
import { expect } from "chai";

// TODO unskip once we have a mechanism to run only on specific versions
// TODO as these tests can only work against 8.0 or higher
describe.skip("hgetex", () => {
  it("should return values and null for missing field", async () => {
    const redis = new Redis();
    const key = `test_hgetex_${Date.now()}`;

    await redis.hset(key, "field1", "value1", "field2", "value2");
    const result = await redis.hgetex(
      key,
      "FIELDS",
      3,
      "field1",
      "field2",
      "missing_field"
    );

    expect(result).to.deep.equal(["value1", "value2", null]);
  });

  it("should return buffers and null for missing field", async () => {
    const redis = new Redis();
    const key = `test_hgetex_buf_${Date.now()}`;

    await redis.hset(key, "field1", "value1", "field2", "value2");
    const result = await redis.hgetexBuffer(
      key,
      "PERSIST",
      "FIELDS",
      3,
      "field1",
      "field2",
      "missing_field"
    );

    expect(result).to.have.lengthOf(3);
    expect(result[0]?.toString()).to.equal("value1");
    expect(result[1]?.toString()).to.equal("value2");
    expect(result[2]).to.equal(null);
  });

  it("should support EX option", async () => {
    const redis = new Redis();
    const key = `test_hgetex_ex_${Date.now()}`;

    await redis.hset(key, "field1", "value1");
    const result = await redis.hgetex(key, "EX", 60, "FIELDS", 1, "field1");

    expect(result).to.deep.equal(["value1"]);
  });

  it("should support PX option", async () => {
    const redis = new Redis();
    const key = `test_hgetex_px_${Date.now()}`;

    await redis.hset(key, "field1", "value1");
    const result = await redis.hgetex(key, "PX", 60_000, "FIELDS", 1, "field1");

    expect(result).to.deep.equal(["value1"]);
  });

  it("should support EXAT option", async () => {
    const redis = new Redis();
    const key = `test_hgetex_exat_${Date.now()}`;
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 60;

    await redis.hset(key, "field1", "value1");
    const result = await redis.hgetex(
      key,
      "EXAT",
      expiresAtSeconds,
      "FIELDS",
      1,
      "field1"
    );

    expect(result).to.deep.equal(["value1"]);
  });

  it("should support PXAT option", async () => {
    const redis = new Redis();
    const key = `test_hgetex_pxat_${Date.now()}`;
    const expiresAtMilliseconds = Date.now() + 60_000;

    await redis.hset(key, "field1", "value1");
    const result = await redis.hgetex(
      key,
      "PXAT",
      expiresAtMilliseconds,
      "FIELDS",
      1,
      "field1"
    );

    expect(result).to.deep.equal(["value1"]);
  });

  it("should support PERSIST option", async () => {
    const redis = new Redis();
    const key = `test_hgetex_persist_${Date.now()}`;

    await redis.hset(key, "field1", "value1");
    const result = await redis.hgetex(key, "PERSIST", "FIELDS", 1, "field1");

    expect(result).to.deep.equal(["value1"]);
  });
});
