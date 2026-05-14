import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";

describe("increx", function () {
  let redis: Redis;

  before(async function () {
    if (await isRedisVersionLowerThan("8.8")) {
      this.skip();
    }
  });

  beforeEach(() => {
    redis = new Redis();
  });

  afterEach(() => {
    redis.disconnect();
  });

  it("increments by one by default", async () => {
    const key = `increx_default_${Date.now()}`;

    const result = await redis.increx(key);

    expect(result).to.deep.equal([1, 1]);
  });

  it("supports BYINT with bounds, overflow policy, and expiration options", async () => {
    const key = `increx_byint_${Date.now()}`;

    await redis.set(key, 5);
    const result = await redis.increx(
      key,
      "BYINT",
      20,
      "LBOUND",
      0,
      "UBOUND",
      10,
      "OVERFLOW",
      "SAT",
      "EX",
      60
    );

    expect(result).to.deep.equal([10, 5]);
    expect(await redis.ttl(key)).to.be.greaterThan(0);
  });

  it("supports expiration-only integer options", async () => {
    const key = `increx_expiration_${Date.now()}`;

    const result = await redis.increx(key, "EX", 60, "ENX");

    expect(result).to.deep.equal([1, 1]);
    expect(await redis.ttl(key)).to.be.greaterThan(0);
  });

  it("supports PERSIST without an explicit increment mode", async () => {
    const key = `increx_persist_${Date.now()}`;

    await redis.set(key, 10, "EX", 60);
    const result = await redis.increx(key, "PERSIST");

    expect(result).to.deep.equal([11, 1]);
    expect(await redis.ttl(key)).to.equal(-1);
  });

  it("returns string values for BYFLOAT", async () => {
    const key = `increx_byfloat_${Date.now()}`;

    const result = await redis.increx(key, "BYFLOAT", "0.5", "EX", 60, "ENX");

    expect(result).to.deep.equal(["0.5", "0.5"]);
  });

  it("supports BYFLOAT with bounds, overflow policy, and expiration options", async () => {
    const key = `increx_byfloat_options_${Date.now()}`;

    const result = await redis.increx(
      key,
      "BYFLOAT",
      "0.5",
      "LBOUND",
      "0",
      "UBOUND",
      "10",
      "OVERFLOW",
      "SAT",
      "PX",
      60_000,
      "ENX"
    );

    expect(result).to.deep.equal(["0.5", "0.5"]);
    expect(await redis.pttl(key)).to.be.greaterThan(0);
  });

  it("returns string values when BYFLOAT follows another option", async () => {
    const key = `increx_byfloat_order_${Date.now()}`;

    const result = await redis.increx(key, "EX", 60, "BYFLOAT", "0.5");

    expect(result).to.deep.equal(["0.5", "0.5"]);
  });

  it("supports PERSIST before BYFLOAT", async () => {
    const key = `increx_persist_byfloat_${Date.now()}`;

    await redis.set(key, "1.25", "EX", 60);
    const result = await redis.increx(key, "PERSIST", "BYFLOAT", "0.25");

    expect(result).to.deep.equal(["1.5", "0.25"]);
    expect(await redis.ttl(key)).to.equal(-1);
  });

  it("returns buffers for BYFLOAT buffer variant", async () => {
    const key = `increx_byfloat_buffer_${Date.now()}`;

    const result = await redis.increxBuffer(key, "BYFLOAT", "0.5");

    expect(result).to.have.lengthOf(2);
    expect(result[0]).to.be.instanceOf(Buffer);
    expect(result[1]).to.be.instanceOf(Buffer);
    expect(result.map((item) => item.toString())).to.deep.equal(["0.5", "0.5"]);
  });

  it("keeps integer replies as numbers for buffer variant", async () => {
    const key = `increx_integer_buffer_${Date.now()}`;

    const result = await redis.increxBuffer(key, "EX", 60);

    expect(result).to.deep.equal([1, 1]);
  });

  it("supports callback form", async () => {
    const key = `increx_callback_${Date.now()}`;

    await new Promise<void>((resolve, reject) => {
      redis.increx(key, "BYINT", 2, (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        try {
          expect(result).to.deep.equal([2, 2]);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      });
    });
  });
});
