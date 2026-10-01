import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";
import { isReCluster } from "../../helpers/re-config";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`memory (${name})`, function () {
    let redis: Redis;

    before(function () {
      if (isReCluster()) {
        this.skip();
      }
    });

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("USAGE returns the memory used by a key", async () => {
      const key = `memory:${Date.now()}`;
      await redis.set(key, "value");

      const usage = await redis.memory("USAGE", key);

      expect(usage).to.be.a("number");
      expect(usage).to.be.greaterThan(0);
    });

    it("USAGE returns null for a missing key", async () => {
      expect(await redis.memory("USAGE", `memory:missing:${Date.now()}`)).to.equal(
        null
      );
    });

    it("DOCTOR returns a report string", async () => {
      expect(await redis.memory("DOCTOR")).to.be.a("string");
    });

    it("STATS returns memory statistics", async () => {
      const expectedType: Record<ReplyMapping, string> = {
        legacy: "array",
        resp3: "object",
      };

      expect(await redis.memory("STATS")).to.be.an(
        expectedType[opts.replyMapping]
      );
    });
  });
}
