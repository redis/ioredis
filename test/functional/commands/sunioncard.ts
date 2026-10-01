import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`sunioncard (${name})`, function () {
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

    it("returns the cardinality of a set union", async () => {
      const key1 = `sunioncard:cardinality:${Date.now()}:1`;
      const key2 = `sunioncard:cardinality:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c"]);
      await redis.sadd(key2, ["b", "c", "d"]);

      expect(await redis.sunioncard(2, [key1, key2])).to.equal(4);
    });

    it("supports LIMIT", async () => {
      const key1 = `sunioncard:limit:${Date.now()}:1`;
      const key2 = `sunioncard:limit:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c"]);
      await redis.sadd(key2, ["d", "e"]);

      expect(await redis.sunioncard(2, key1, key2, "LIMIT", 3)).to.equal(3);
    });

    it("supports APPROX followed by LIMIT", async () => {
      const key1 = `sunioncard:approx:${Date.now()}:1`;
      const key2 = `sunioncard:approx:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b", "c"]);
      await redis.sadd(key2, ["d", "e"]);

      const cardinality = await redis.sunioncard(
        2,
        key1,
        key2,
        "APPROX",
        "LIMIT",
        3
      );

      expect(cardinality).to.be.a("number");
      expect(cardinality).to.be.at.most(3);
    });

    it("supports callback replies", async () => {
      const key1 = `sunioncard:callback:${Date.now()}:1`;
      const key2 = `sunioncard:callback:${Date.now()}:2`;
      await redis.sadd(key1, ["a", "b"]);
      await redis.sadd(key2, ["c", "d"]);

      const cardinality = await new Promise<number>((resolve, reject) => {
        redis.sunioncard(2, key1, key2, "LIMIT", 2, (err, result) => {
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
