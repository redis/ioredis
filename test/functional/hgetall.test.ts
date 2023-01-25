import { describe, expect, it } from "@jest/globals";
import Redis from "../../lib/Redis";

const CUSTOM_PROPERTY = "_myCustomProperty";

describe("hgetall", () => {
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
      "world"
    );
    const ret = await redis.hgetall("test_key");
    expect(ret.__proto__).toBe("hello");
    expect(ret[CUSTOM_PROPERTY]).toBe("world");
    expect(Object.keys(ret).sort()).toEqual(
      ["__proto__", CUSTOM_PROPERTY].sort()
    );
    expect(Object.getPrototypeOf(ret)).toBe(Object.prototype);
  });
});
