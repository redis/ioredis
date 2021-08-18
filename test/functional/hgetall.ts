import Redis from "../../lib/redis";
import { expect } from "chai";

const CUSTOM_PROPERTY = "_myCustomProperty";

describe("hgetall", function () {
  beforeEach(function () {
    Object.defineProperty(Object.prototype, CUSTOM_PROPERTY, {
      value: false,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  });

  afterEach(function () {
    delete (Object.prototype as any)[CUSTOM_PROPERTY];
  });

  it("should handle special field names", async function () {
    const redis = new Redis();
    await redis.hmset(
      "test_key",
      "__proto__",
      "hello",
      CUSTOM_PROPERTY,
      "world"
    );
    const ret = await redis.hgetall("test_key");
    expect(ret.__proto__).to.eql("hello");
    expect(ret[CUSTOM_PROPERTY]).to.eql("world");
    expect(Object.keys(ret).sort()).to.eql(
      ["__proto__", CUSTOM_PROPERTY].sort()
    );
    expect(Object.getPrototypeOf(ret)).to.eql(Object.prototype);
  });
});
