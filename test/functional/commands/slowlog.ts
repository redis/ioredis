import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`slowlog (${name})`, () => {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("GET returns the slow log entries", async () => {
      const entries = (await redis.slowlog("GET")) as unknown[];

      expect(entries).to.be.an("array");
    });

    it("LEN returns the number of entries", async () => {
      const length = await redis.slowlog("LEN");

      expect(length).to.be.a("number");
      expect(length).to.be.at.least(0);
    });

    it("RESET returns OK", async () => {
      expect(await redis.slowlog("RESET")).to.equal("OK");
    });
  });
}
