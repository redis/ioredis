import { describe, expect, it } from "@jest/globals";
import Redis from "../../lib/Redis";

describe("duplicate", () => {
  it("clone the options", () => {
    const redis = new Redis();
    const duplicatedRedis = redis.duplicate();
    redis.options.port = 1234;
    expect(duplicatedRedis.options.port).toBe(6379);
  });
});
