import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`spublish (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("7.0.0")) {
        this.skip();
      }
    });

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the number of clients that received the message", async () => {
      const channel = `spublish:${Date.now()}`;

      expect(await redis.spublish(channel, "message")).to.equal(0);
    });

    it("counts a shard-subscribed client", async () => {
      const channel = `spublish:${Date.now()}`;
      const subscriber = new Redis(opts);

      try {
        await subscriber.ssubscribe(channel);

        expect(await redis.spublish(channel, "message")).to.equal(1);
      } finally {
        subscriber.disconnect();
      }
    });
  });
}
