import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`command (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("COUNT returns the number of commands", async () => {
      const count = await redis.command("COUNT");

      expect(count).to.be.a("number");
      expect(count).to.be.greaterThan(0);
    });

    it("INFO returns details for the requested command", async () => {
      const reply = (await redis.command("INFO", "get")) as unknown[];

      expect(reply).to.be.an("array");
      expect(reply).to.have.lengthOf(1);

      const entry = reply[0] as unknown[];
      expect(entry[0]).to.equal("get");
    });
  });
}
