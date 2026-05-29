import { expect } from "chai";
import Redis from "../../lib/Redis";
import { isRedisVersionLowerThan } from "../helpers/util";

describe("resp3", function () {
  before(async function () {
    if (await isRedisVersionLowerThan("6.0")) {
      this.skip();
    }
  });

  it("supports set and get against Redis", async () => {
    const redis = new Redis({ protocol: 3 });
    const key = `resp3:${Date.now()}`;

    try {
      expect(await redis.set(key, "value")).to.equal("OK");
      expect(await redis.get(key)).to.equal("value");
    } finally {
      redis.disconnect();
    }
  });
});
