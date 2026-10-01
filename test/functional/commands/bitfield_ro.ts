import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`bitfield_ro (${name})`, function () {
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

    it("returns the result of a GET on a missing key", async () => {
      const key = `bitfield_ro:${Date.now()}`;

      expect(await redis.bitfield_ro(key, "GET", "i8", 0)).to.eql([0]);
    });

    it("returns the stored value", async () => {
      const key = `bitfield_ro:${Date.now()}`;
      await redis.bitfield(key, "SET", "u8", 0, 255);

      expect(await redis.bitfield_ro(key, "GET", "u8", 0)).to.eql([255]);
    });
  });
}
