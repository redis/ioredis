import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`ping (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns PONG without a message", async () => {
      expect(await redis.ping()).to.equal("PONG");
    });

    it("echoes the given message", async () => {
      expect(await redis.ping("hello")).to.equal("hello");
    });
  });
}
