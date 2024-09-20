import Redis from "../../lib/Redis";
import { expect } from "chai";

const CUSTOM_PROPERTY = "_myCustomProperty";

describe("hexpire", () => {
  beforeEach(() => {
    Object.defineProperty(Object.prototype, CUSTOM_PROPERTY, {
      value: false,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  });

  afterEach(() => {
    delete (Object.prototype as any)[CUSTOM_PROPERTY];
  });

  it("should handle special field names", async () => {
    const redis = new Redis();
    await redis.hmset(
      "test_key",
      "__proto__",
      "hello",
      CUSTOM_PROPERTY,
      "world",
      "leftbehind",
      "stays"
    );
    var expireResult = await redis.hexpire(
      "test_key",
      1,
      "NX",
      "FIELDS",
      2,
      "__proto__",
      CUSTOM_PROPERTY
    );
    await new Promise((r) => setTimeout(r, 3000));
    const ret = await redis.hgetall("test_key");
    expect(Object.getPrototypeOf(ret)).to.eql(Object.prototype);
    expect(Object.keys(ret).sort()).to.eql(["leftbehind"].sort());
    expect(ret.leftbehind).to.eql("stays");
  });
});
