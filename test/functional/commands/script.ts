import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

const SHA1_PATTERN = /^[0-9a-f]{40}$/;

for (const { name, opts } of RESP_CONFIGS) {
  describe(`script (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.script("FLUSH");
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("LOAD returns the script sha", async () => {
      const sha = await redis.script("LOAD", "return 1");

      expect(sha).to.be.a("string");
      expect(sha).to.match(SHA1_PATTERN);
    });

    it("EXISTS reports whether a loaded script is cached", async () => {
      const sha = (await redis.script("LOAD", "return 1")) as string;

      expect(await redis.script("EXISTS", sha)).to.eql([1]);
      expect(await redis.script("EXISTS", "0".repeat(40))).to.eql([0]);
    });
  });
}
