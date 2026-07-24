import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xgroup (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("CREATE returns OK", async () => {
      const key = `xgroup:${Date.now()}`;

      expect(await redis.xgroup("CREATE", key, "group", "$", "MKSTREAM")).to.equal(
        "OK"
      );
    });

    it("SETID returns OK", async () => {
      const key = `xgroup:${Date.now()}`;
      await redis.xgroup("CREATE", key, "group", "$", "MKSTREAM");

      expect(await redis.xgroup("SETID", key, "group", "0")).to.equal("OK");
    });

    it("DESTROY returns the number of destroyed groups", async () => {
      const key = `xgroup:${Date.now()}`;
      await redis.xgroup("CREATE", key, "group", "$", "MKSTREAM");

      expect(await redis.xgroup("DESTROY", key, "group")).to.equal(1);
    });

    it("CREATECONSUMER returns the number of created consumers", async function () {
      if (await isRedisVersionLowerThan("6.2")) {
        this.skip();
      }

      const key = `xgroup:${Date.now()}`;
      await redis.xgroup("CREATE", key, "group", "$", "MKSTREAM");

      expect(
        await redis.xgroup("CREATECONSUMER", key, "group", "consumer")
      ).to.equal(1);
    });

    it("DELCONSUMER returns the number of pending messages the consumer had", async () => {
      const key = `xgroup:${Date.now()}`;
      await redis.xgroup("CREATE", key, "group", "$", "MKSTREAM");

      expect(await redis.xgroup("DELCONSUMER", key, "group", "consumer")).to.equal(
        0
      );
    });
  });
}
