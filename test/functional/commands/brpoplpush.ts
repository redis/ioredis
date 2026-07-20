import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`brpoplpush (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null when the timeout elapses", async () => {
      const source = `brpoplpush:${Date.now()}:src`;
      const destination = `brpoplpush:${Date.now()}:dst`;

      expect(await redis.brpoplpush(source, destination, 0.001)).to.equal(null);
    });

    it("moves the last element and returns it", async () => {
      const source = `brpoplpush:${Date.now()}:src`;
      const destination = `brpoplpush:${Date.now()}:dst`;
      await redis.rpush(source, "a", "b", "c");

      expect(await redis.brpoplpush(source, destination, 0.001)).to.equal("c");
      expect(await redis.lrange(source, 0, -1)).to.eql(["a", "b"]);
      expect(await redis.lrange(destination, 0, -1)).to.eql(["c"]);
    });
  });
}
