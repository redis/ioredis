import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`rename (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("renames the key and returns OK", async () => {
      const source = `rename:src:${Date.now()}`;
      const destination = `rename:dst:${Date.now()}`;
      await redis.set(source, "value");

      expect(await redis.rename(source, destination)).to.equal("OK");
      expect(await redis.get(destination)).to.equal("value");
    });
  });
}
