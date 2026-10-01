import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`module (${name})`, () => {
    let redis: Redis;

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("LIST returns an array of loaded modules", async () => {
      const modules = (await redis.module("LIST")) as unknown[];

      expect(modules).to.be.an("array");
    });
  });
}
