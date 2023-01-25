import { describe, expect, it } from "@jest/globals";
import Redis from "../../lib/Redis";

const MAX_NUMBER = 9007199254740991; // Number.MAX_SAFE_INTEGER

describe("stringNumbers", () => {
  describe("enabled", () => {
    it("returns numbers as strings", async () => {
      const redis = new Redis({
        stringNumbers: true,
      });

      await redis.set("foo", MAX_NUMBER);
      expect(await redis.incr("foo")).toBe("9007199254740992");
      expect(await redis.incr("foo")).toBe("9007199254740993");
      expect(await redis.incr("foo")).toBe("9007199254740994");

      // also works for small integer
      await redis.set("foo", 123);
      expect(await redis.incr("foo")).toBe("124");

      // and floats
      await redis.set("foo", 123.23);
      const float = Number(await redis.incrbyfloat("foo", 1.2));
      expect(float).toBeGreaterThanOrEqual(124.42999);
      expect(float).toBeLessThanOrEqual(124.430001);
    });
  });

  describe("disabled", () => {
    it("returns numbers", async () => {
      const redis = new Redis();

      redis.set("foo", "123");
      expect(await redis.incr("foo")).toBe(124);
    });
  });
});
