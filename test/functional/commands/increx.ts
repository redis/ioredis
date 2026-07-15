import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";
import { isReCluster } from "../../helpers/re-config";

describe("increx", function () {
  let redis: Redis;

  before(async function () {
    // INCREX is an OSS preview command not available in managed Redis Enterprise.
    if (isReCluster() || (await isRedisVersionLowerThan("8.7"))) {
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

  it("supports BYINT with bounds, SATURATE, and expiration options", async () => {
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
      "SATURATE",
      "EX",
      60,
    );

    expect(result).to.deep.equal([10, 5]);
    expect(await redis.ttl(key)).to.be.greaterThan(0);
  });

  it("saturates BYINT to an explicit LBOUND", async () => {
    const key = `increx_byint_lbound_${Date.now()}`;

    await redis.set(key, 5);
    const result = await redis.increx(
      key,
      "BYINT",
      -20,
      "LBOUND",
      0,
      "SATURATE",
    );

    expect(result).to.deep.equal([0, -5]);
    expect(await redis.get(key)).to.equal("0");
  });

  it("surfaces out-of-bounds BYINT rejection with expiration options", async () => {
    const timestamp = Date.now();
    const cases: Array<{
      key: string;
      options: Array<string | number>;
    }> = [
      { key: `increx_byint_reject_ex_${timestamp}`, options: ["EX", 60] },
      { key: `increx_byint_reject_px_${timestamp}`, options: ["PX", 30_000] },
      { key: `increx_byint_reject_persist_${timestamp}`, options: ["PERSIST"] },
    ];

    for (const { key, options } of cases) {
      await redis.set(key, 10);
      const result = await redis.increx(
        key,
        "BYINT",
        100,
        "UBOUND",
        15,
        ...options
      );

      expect(result).to.deep.equal([10, 0]);
      expect(result[1]).to.equal(0);
    }
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

  it("supports BYFLOAT with bounds, SATURATE, and expiration options", async () => {
    const key = `increx_byfloat_options_${Date.now()}`;

    await redis.set(key, "9.75");
    const result = await redis.increx(
      key,
      "BYFLOAT",
      "0.5",
      "LBOUND",
      "0",
      "UBOUND",
      "10",
      "SATURATE",
      "PX",
      60_000,
      "ENX",
    );

    expect(result).to.deep.equal(["10", "0.25"]);
    expect(await redis.pttl(key)).to.be.greaterThan(0);
  });

  it("surfaces out-of-bounds BYFLOAT rejection without SATURATE", async () => {
    const key = `increx_byfloat_reject_${Date.now()}`;

    await redis.set(key, "9.75");
    const result = await redis.increx(
      key,
      "BYFLOAT",
      "0.5",
      "UBOUND",
      "10",
    );

    expect(result).to.deep.equal(["9.75", "0"]);
    expect(result[1]).to.equal("0");
  });

  it("supports PERSIST after BYFLOAT", async () => {
    const key = `increx_persist_byfloat_${Date.now()}`;

    await redis.set(key, "1.25", "EX", 60);
    const result = await redis.increx(key, "BYFLOAT", "0.25", "PERSIST");

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
