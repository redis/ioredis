import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`object (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("HELP returns an array of help lines", async () => {
      const reply = await redis.object("HELP");

      expect(reply).to.be.an("array");
      expect((reply as unknown[]).length).to.be.greaterThan(0);
    });

    it("ENCODING returns the internal encoding of the value", async () => {
      const key = `object:${Date.now()}`;
      await redis.set(key, "value");

      expect(await redis.object("ENCODING", key)).to.be.a("string");
    });
  });
}
