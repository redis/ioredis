import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";

describe("hgetdel", function () {
  before(async function () {
    if (await isRedisVersionLowerThan("8.0")) {
      this.skip();
    }
  });

  it("should return values and null for missing field", async () => {
    const redis = new Redis();
    const key = `test_hgetdel_${Date.now()}`;

    await redis.hset(key, "field1", "value1", "field2", "value2");
    const result = await redis.hgetdel(
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
    const key = `test_hgetdel_buf_${Date.now()}`;

    await redis.hset(key, "field1", "value1", "field2", "value2");
    const result = await redis.hgetdelBuffer(
      key,
      "FIELDS",
      3,
      "field1",
      "field2",
      "missing_field"
    );

    expect(result).to.have.lengthOf(3);
    expect(Buffer.isBuffer(result[0])).to.equal(true);
    expect(Buffer.isBuffer(result[1])).to.equal(true);
    expect(result[0]?.toString()).to.equal("value1");
    expect(result[1]?.toString()).to.equal("value2");
    expect(result[2]).to.equal(null);
  });
});
