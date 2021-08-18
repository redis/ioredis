import Redis from "../../lib/redis";
import { expect } from "chai";

describe("hgetall", function () {
  it("should handle __proto__", async function () {
    const redis = new Redis();
    await redis.hset("test_key", "__proto__", "hello");
    const ret = await redis.hgetall("test_key");
    expect(ret.__proto__).to.eql("hello");
    expect(Object.keys(ret)).to.eql(["__proto__"]);
  });
});
