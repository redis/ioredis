import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";

describe("msetex", function () {
  before(async function () {
    if (await isRedisVersionLowerThan("8.4")) {
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

  it("should set a single key and return 1", async () => {
    const key = `test_msetex_single_${Date.now()}`;

    const result = await redis.msetex(1, key, "value1");

    expect(result).to.equal(1);
  });

  it("should set multiple keys and return 1", async () => {
    const ts = Date.now();
    const key1 = `test_msetex_multi_1_${ts}`;
    const key2 = `test_msetex_multi_2_${ts}`;

    const result = await redis.msetex(2, key1, "value1", key2, "value2");

    expect(result).to.equal(1);
  });

  it("should return 1 with NX when none of the keys exist", async () => {
    const key = `test_msetex_nx_new_${Date.now()}`;

    const result = await redis.msetex(1, key, "value1", "NX");

    expect(result).to.equal(1);
  });

  it("should return 0 with NX when any key already exists", async () => {
    const key = `test_msetex_nx_exists_${Date.now()}`;

    await redis.set(key, "existing");
    const result = await redis.msetex(1, key, "value1", "NX");

    expect(result).to.equal(0);
  });

  it("should return 0 with XX when keys do not exist", async () => {
    const key = `test_msetex_xx_missing_${Date.now()}`;

    const result = await redis.msetex(1, key, "value1", "XX");

    expect(result).to.equal(0);
  });

  it("should return 1 with XX when all keys already exist", async () => {
    const key = `test_msetex_xx_exists_${Date.now()}`;

    await redis.set(key, "existing");
    const result = await redis.msetex(1, key, "updated", "XX");

    expect(result).to.equal(1);
  });

  it("should set a TTL with EX option", async () => {
    const key = `test_msetex_ex_${Date.now()}`;

    const result = await redis.msetex(1, key, "value1", "EX", 120);

    expect(result).to.equal(1);
  });

  it("should set a TTL with PX option", async () => {
    const key = `test_msetex_px_${Date.now()}`;

    const result = await redis.msetex(1, key, "value1", "PX", 120_000);

    expect(result).to.equal(1);
  });

  it("should set a TTL with EXAT option", async () => {
    const key = `test_msetex_exat_${Date.now()}`;
    const expiresAt = Math.floor(Date.now() / 1000) + 300;

    const result = await redis.msetex(1, key, "value1", "EXAT", expiresAt);

    expect(result).to.equal(1);
  });

  it("should set a TTL with PXAT option", async () => {
    const key = `test_msetex_pxat_${Date.now()}`;
    const expiresAt = Date.now() + 300_000;

    const result = await redis.msetex(1, key, "value1", "PXAT", expiresAt);

    expect(result).to.equal(1);
  });

  it("should support KEEPTTL option", async () => {
    const key = `test_msetex_keepttl_${Date.now()}`;

    await redis.msetex(1, key, "original", "EX", 120);
    const result = await redis.msetex(1, key, "updated", "KEEPTTL");

    expect(result).to.equal(1);
  });

  it("should support combined NX + EX options", async () => {
    const key = `test_msetex_nx_ex_${Date.now()}`;

    const first = await redis.msetex(1, key, "value1", "NX", "EX", 120);
    const second = await redis.msetex(1, key, "value2", "NX", "EX", 120);

    expect(first).to.equal(1);
    expect(second).to.equal(0);
  });
});
