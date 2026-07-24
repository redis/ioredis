import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`rpoplpush (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null when the source is missing", async () => {
      const source = `rpoplpush:${Date.now()}:src`;
      const destination = `rpoplpush:${Date.now()}:dst`;

      expect(await redis.rpoplpush(source, destination)).to.equal(null);
    });

    it("moves the last element and returns it", async () => {
      const source = `rpoplpush:${Date.now()}:src`;
      const destination = `rpoplpush:${Date.now()}:dst`;
      await redis.rpush(source, "a", "b", "c");

      expect(await redis.rpoplpush(source, destination)).to.equal("c");
      expect(await redis.lrange(source, 0, -1)).to.eql(["a", "b"]);
      expect(await redis.lrange(destination, 0, -1)).to.eql(["c"]);
    });
  });
}
