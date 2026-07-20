import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`restore (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("restores a serialized value and returns OK", async () => {
      const source = `restore:src:${Date.now()}`;
      const destination = `restore:dst:${Date.now()}`;
      await redis.set(source, "value");
      const dumped = await redis.dumpBuffer(source);

      expect(await redis.restore(destination, 0, dumped)).to.equal("OK");
      expect(await redis.get(destination)).to.equal("value");
    });
  });
}
