import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sort (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the sorted elements of a list", async () => {
      const key = `sort:${Date.now()}`;
      await redis.rpush(key, "3", "1", "2");

      expect(await redis.sort(key)).to.eql(["1", "2", "3"]);
    });

    it("sorts in descending order with DESC", async () => {
      const key = `sort:${Date.now()}`;
      await redis.rpush(key, "1", "3", "2");

      expect(await redis.sort(key, "DESC")).to.eql(["3", "2", "1"]);
    });

    it("returns the number of stored elements with STORE", async () => {
      const key = `sort:${Date.now()}`;
      const dest = `sort:dest:${Date.now()}`;
      await redis.rpush(key, "3", "1", "2");

      expect(await redis.sort(key, "STORE", dest)).to.equal(3);
    });
  });
}
