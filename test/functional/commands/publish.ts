import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`publish (${name})`, () => {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the number of clients that received the message", async () => {
      const channel = `publish:${Date.now()}`;

      expect(await redis.publish(channel, "message")).to.equal(0);
    });

    it("counts a subscribed client", async () => {
      const channel = `publish:${Date.now()}`;
      const subscriber = new Redis(opts);

      try {
        await subscriber.subscribe(channel);

        expect(await redis.publish(channel, "message")).to.equal(1);
      } finally {
        subscriber.disconnect();
      }
    });
  });
}
