import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`pfmerge (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns OK", async () => {
      const dest = `pfmerge:dest:${Date.now()}`;
      const source = `pfmerge:source:${Date.now()}`;

      expect(await redis.pfmerge(dest, source)).to.equal("OK");
    });

    it("merges the source HyperLogLogs into the destination", async () => {
      const dest = `pfmerge:dest:${Date.now()}`;
      const source1 = `pfmerge:source1:${Date.now()}`;
      const source2 = `pfmerge:source2:${Date.now()}`;
      await redis.pfadd(source1, "a", "b");
      await redis.pfadd(source2, "c");

      expect(await redis.pfmerge(dest, source1, source2)).to.equal("OK");
      expect(await redis.pfcount(dest)).to.equal(3);
    });
  });
}
