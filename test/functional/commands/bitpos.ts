import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`bitpos (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns -1 when searching a missing key from an offset", async () => {
      const key = `bitpos:${Date.now()}`;

      expect(await redis.bitpos(key, 1, 1)).to.equal(-1);
    });

    it("returns the position of the first set bit", async () => {
      const key = `bitpos:${Date.now()}`;
      // 0x00 0xff 0xf0 -> first set bit at position 8
      await redis.set(key, Buffer.from([0x00, 0xff, 0xf0]));

      expect(await redis.bitpos(key, 1)).to.equal(8);
    });
  });
}
