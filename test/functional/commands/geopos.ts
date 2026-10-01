import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`geopos (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns null for a missing member", async () => {
      const key = `geopos:${Date.now()}`;

      expect(await redis.geopos(key, "member")).to.eql([null]);
    });

    it("returns the coordinates of a member", async () => {
      const key = `geopos:${Date.now()}`;
      const longitude = 13.361389;
      const latitude = 38.115556;
      await redis.geoadd(key, longitude, latitude, "Palermo");

      const reply = await redis.geopos(key, "Palermo");

      expect(reply).to.have.length(1);
      const position = reply[0] as [string, string];
      expect(position).to.not.equal(null);
      // Geo coordinates are stored with limited precision; compare to a few
      // decimal places rather than asserting an exact float string.
      expect(Number(position[0])).to.be.closeTo(longitude, 1e-4);
      expect(Number(position[1])).to.be.closeTo(latitude, 1e-4);
    });
  });
}
