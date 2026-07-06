import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hrandfield (${name})`, () => {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("6.2")) {
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

    it("returns null for a missing key", async () => {
      const key = `hrandfield:${Date.now()}`;

      expect(await redis.hrandfield(key)).to.equal(null);
    });

    it("returns a field name", async () => {
      const key = `hrandfield:${Date.now()}`;
      await redis.hset(key, "field", "value");

      expect(await redis.hrandfield(key)).to.equal("field");
    });

    it("returns field-value pairs with WITHVALUES", async () => {
      const key = `hrandfield:${Date.now()}`;
      await redis.hset(key, "field", "value");

      const expected: Record<ReplyMapping, unknown> = {
        legacy: ["field", "value"],
        resp3: [["field", "value"]],
      };

      expect(await redis.hrandfield(key, 1, "WITHVALUES")).to.eql(
        expected[opts.replyMapping]
      );
    });
  });
}
