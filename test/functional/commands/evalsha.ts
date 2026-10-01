import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`evalsha (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("runs a previously loaded script by sha", async () => {
      const sha = (await redis.script("LOAD", "return 1")) as string;

      expect(await redis.evalsha(sha, 0)).to.equal(1);
    });
  });
}
