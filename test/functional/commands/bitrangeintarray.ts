import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

// Bits 1, 7, 9 and 30 are set.
const BITMAP = Buffer.from([0x41, 0x40, 0x00, 0x02]);

for (const { name, opts } of RESP_CONFIGS) {
  describe(`bitrangeintarray (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("8.11")) {
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

    it("returns the offsets of the set bits", async () => {
      const key = `bitrangeintarray_set_${Date.now()}`;
      await redis.set(key, BITMAP);

      expect(await redis.bitrangeintarray(key, 0, -1)).to.deep.equal([
        1, 7, 9, 30,
      ]);
    });

    it("accepts BYTE and BIT ranges", async () => {
      const key = `bitrangeintarray_unit_${Date.now()}`;
      await redis.set(key, BITMAP);

      expect(await redis.bitrangeintarray(key, 1, -1)).to.deep.equal([9, 30]);
      expect(await redis.bitrangeintarray(key, 1, -1, "BYTE")).to.deep.equal([
        9, 30,
      ]);
      expect(await redis.bitrangeintarray(key, 5, 10, "BIT")).to.deep.equal([
        7, 9,
      ]);
    });

    it("returns the offsets of the clear bits with ZEROS", async () => {
      const key = `bitrangeintarray_zeros_${Date.now()}`;
      await redis.set(key, BITMAP);

      expect(
        await redis.bitrangeintarray(key, 24, 31, "BIT", "ZEROS")
      ).to.deep.equal([24, 25, 26, 27, 28, 29, 31]);
      expect(await redis.bitrangeintarray(key, 3, 3, "ZEROS")).to.deep.equal([
        24, 25, 26, 27, 28, 29, 31,
      ]);
    });

    it("limits the number of offsets with LIMIT", async () => {
      const key = `bitrangeintarray_limit_${Date.now()}`;
      await redis.set(key, BITMAP);

      expect(
        await redis.bitrangeintarray(key, 0, -1, "BIT", "LIMIT", 1)
      ).to.deep.equal([1]);
      expect(
        await redis.bitrangeintarray(key, 0, -1, "LIMIT", 1)
      ).to.deep.equal([1, 7]);
      expect(
        await redis.bitrangeintarray(key, 0, -1, "BIT", "LIMIT", 2, "ZEROS")
      ).to.deep.equal([0, 2]);
    });

    it("returns an empty array for a missing key", async () => {
      const key = `bitrangeintarray_missing_${Date.now()}`;

      expect(await redis.bitrangeintarray(key, 0, -1)).to.deep.equal([]);
    });

    it("supports callbacks", (done) => {
      const key = `bitrangeintarray_callback_${Date.now()}`;

      redis.set(key, BITMAP).then(() => {
        redis.bitrangeintarray(key, 0, -1, (err, result) => {
          if (err) return done(err);
          expect(result).to.deep.equal([1, 7, 9, 30]);
          done();
        });
      }, done);
    });
  });
}
