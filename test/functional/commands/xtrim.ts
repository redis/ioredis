import Redis from "../../../lib/Redis";
import { expect } from "chai";

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

  // TODO add a mechanism to skip tests based on server version
  it.skip("xtrim with policy (DELREF) returns a number when supported", async function (this: any) {
    const res = await redis.xtrim("{tag}key", "MAXLEN", 0, "DELREF");
    expect(res).to.be.a("number");
  });

  // TODO add a mechanism to skip tests based on server version
  it.skip("xtrim with all options (MINID ~ LIMIT KEEPREF) returns a number when supported", async function (this: any) {
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
  });
});
