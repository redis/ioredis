import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`info (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the server information string", async () => {
      const info = await redis.info();

      expect(info).to.be.a("string");
      expect(info).to.include("redis_version:");
    });

    it("returns a single requested section", async () => {
      const info = await redis.info("server");

      expect(info).to.be.a("string");
      expect(info).to.include("# Server");
    });
  });
}
