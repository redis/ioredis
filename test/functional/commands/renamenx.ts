import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`renamenx (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns 1 when the destination does not exist", async () => {
      const source = `renamenx:src:${Date.now()}`;
      const destination = `renamenx:dst:${Date.now()}`;
      await redis.set(source, "value");

      expect(await redis.renamenx(source, destination)).to.equal(1);
      expect(await redis.get(destination)).to.equal("value");
    });

    it("returns 0 when the destination already exists", async () => {
      const source = `renamenx:src:${Date.now()}`;
      const destination = `renamenx:dst:${Date.now()}`;
      await redis.set(source, "value");
      await redis.set(destination, "other");

      expect(await redis.renamenx(source, destination)).to.equal(0);
    });
  });
}
