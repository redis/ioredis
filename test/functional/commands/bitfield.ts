import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`bitfield (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the result of a GET on a missing key", async () => {
      const key = `bitfield:${Date.now()}`;

      expect(await redis.bitfield(key, "GET", "i8", 0)).to.eql([0]);
    });

    it("returns the results of a SET and GET", async () => {
      const key = `bitfield:${Date.now()}`;

      expect(await redis.bitfield(key, "SET", "u8", 0, 255)).to.eql([0]);
      expect(await redis.bitfield(key, "GET", "u8", 0)).to.eql([255]);
    });
  });
}
