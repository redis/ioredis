import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";

describe("xtrim", () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new Redis();
  });

  afterEach(() => {
    redis.disconnect();
  });

  it("xtrim with MAXLEN returns a number", async () => {
    const res = await redis.xtrim("key", "MAXLEN", 1);
    expect(res).to.be.a("number");
  });

  it("xtrim with MINID returns a number", async () => {
    const res = await redis.xtrim("key", "MINID", 1);
    expect(res).to.be.a("number");
  });

  it("xtrim with string MINID returns a number", async () => {
    const res = await redis.xtrim("key", "MINID", "0-0");
    expect(res).to.be.a("number");
  });

  it("xtrim with LIMIT returns a number", async () => {
    const res = await redis.xtrim("{tag}key", "MAXLEN", "~", 1000, "LIMIT", 10);
    expect(res).to.be.a("number");
  });

  describe("xtrim with policy", function () {
    before(async function () {
      if (await isRedisVersionLowerThan("8.2")) {
        this.skip();
      }
    });

    it("xtrim with policy (DELREF) returns a number when supported", async () => {
      const res = await redis.xtrim("{tag}key", "MAXLEN", 0, "DELREF");
      expect(res).to.be.a("number");
    });

    it(
      "xtrim with all options (MINID ~ LIMIT KEEPREF) returns a number when supported",
      async () => {
        const res = await redis.xtrim(
          "{tag}key",
          "MINID",
          "~",
          0,
          "LIMIT",
          10,
          "KEEPREF"
        );
        expect(res).to.be.a("number");
      }
    );
  });
});
