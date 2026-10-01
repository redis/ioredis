import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`pubsub (${name})`, () => {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("CHANNELS returns the active channels", async () => {
      const channels = (await redis.pubsub("CHANNELS")) as unknown[];

      expect(channels).to.be.an("array");
    });

    it("NUMSUB returns subscriber counts per channel", async () => {
      const channel = `pubsub:${Date.now()}`;

      expect(await redis.pubsub("NUMSUB", channel)).to.eql([channel, 0]);
    });

    it("NUMPAT returns the number of pattern subscriptions", async () => {
      const numpat = await redis.pubsub("NUMPAT");

      expect(numpat).to.be.a("number");
      expect(numpat).to.be.at.least(0);
    });
  });
}
