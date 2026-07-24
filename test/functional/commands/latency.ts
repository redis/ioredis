import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`latency (${name})`, () => {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("HISTORY returns an array of samples for an event", async () => {
      const history = (await redis.latency("HISTORY", "command")) as unknown[];

      expect(history).to.be.an("array");
    });

    it("LATEST returns the latest latency spikes", async () => {
      const latest = (await redis.latency("LATEST")) as unknown[];

      expect(latest).to.be.an("array");
    });

    it("RESET returns the number of cleared events", async () => {
      const cleared = await redis.latency("RESET");

      expect(cleared).to.be.a("number");
      expect(cleared).to.be.at.least(0);
    });
  });
}
