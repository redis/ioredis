import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sdiffcard (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("8.10")) {
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

    it("returns the cardinality of a set difference", async () => {
      const key1 = `sdiffcard:cardinality:${Date.now()}:1`;
      const key2 = `sdiffcard:cardinality:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c", "d"]);
      await redis.sadd(key2, ["b", "d", "e"]);

      expect(await redis.sdiffcard(2, [key1, key2])).to.equal(2);
    });

    it("supports LIMIT", async () => {
      const key1 = `sdiffcard:limit:${Date.now()}:1`;
      const key2 = `sdiffcard:limit:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c"]);
      await redis.sadd(key2, "b");

      expect(await redis.sdiffcard(2, key1, key2, "LIMIT", 1)).to.equal(1);
    });

    it("supports callback replies", async () => {
      const key1 = `sdiffcard:callback:${Date.now()}:1`;
      const key2 = `sdiffcard:callback:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c"]);
      await redis.sadd(key2, "b");

      const cardinality = await new Promise<number>((resolve, reject) => {
        redis.sdiffcard(2, key1, key2, (err, result) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(result as number);
        });
      });

      expect(cardinality).to.equal(2);
    });
  });
}
