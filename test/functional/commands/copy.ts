import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`copy (${name})`, () => {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("6.2")) {
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

    it("returns 0 when the source does not exist", async () => {
      const source = `copy:src:${Date.now()}`;
      const destination = `copy:dst:${Date.now()}`;

      expect(await redis.copy(source, destination)).to.equal(0);
    });

    it("returns 1 when the source is copied", async () => {
      const source = `copy:src:${Date.now()}`;
      const destination = `copy:dst:${Date.now()}`;
      await redis.set(source, "value");

      expect(await redis.copy(source, destination)).to.equal(1);
      expect(await redis.get(destination)).to.equal("value");
    });
  });
}
