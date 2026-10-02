import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`bless (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("8.12")) {
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

    it("SET adds a protection flag and returns a number", async () => {
      const key = `bless_set_${Date.now()}`;
      await redis.set(key, "value");

      const result = await redis.bless("SET", key, "NO-EVICT");
      expect(result).to.be.a("number");
    });

    it("GET returns active flags after SET", async () => {
      const key = `bless_get_${Date.now()}`;
      await redis.set(key, "value");
      await redis.bless("SET", key, "NO-EVICT");

      const flags = await redis.bless("GET", key);
      expect(flags).to.be.an("array");
      expect(flags).to.include("NO-EVICT");
    });

    it("GET returns an empty array when no flags are set", async () => {
      const key = `bless_get_empty_${Date.now()}`;
      await redis.set(key, "value");

      const flags = await redis.bless("GET", key);
      expect(flags).to.be.an("array");
      expect(flags).to.have.length(0);
    });

    it("CLEAR removes a protection flag and returns a number", async () => {
      const key = `bless_clear_${Date.now()}`;
      await redis.set(key, "value");
      await redis.bless("SET", key, "NO-EVICT");

      const result = await redis.bless("CLEAR", key, "NO-EVICT");
      expect(result).to.be.a("number");

      const flags = await redis.bless("GET", key);
      expect(flags).to.not.include("NO-EVICT");
    });

    it("SCAN returns a cursor and list of blessed keys", async () => {
      const key = `bless_scan_${Date.now()}`;
      await redis.set(key, "value");
      await redis.bless("SET", key, "NO-EVICT");

      const [cursor, elements] = await redis.bless(
        "SCAN",
        0,
        "NO-EVICT"
      );
      expect(cursor).to.be.a("string");
      expect(elements).to.be.an("array");
    });

    it("SCAN with COUNT returns a cursor and list of blessed keys", async () => {
      const key = `bless_scan_count_${Date.now()}`;
      await redis.set(key, "value");
      await redis.bless("SET", key, "NO-EVICT");

      const [cursor, elements] = await redis.bless(
        "SCAN",
        0,
        "NO-EVICT",
        "COUNT",
        100
      );
      expect(cursor).to.be.a("string");
      expect(elements).to.be.an("array");
    });
  });
}
