import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

const library = "ioredisfunctioncmd";
const code = `#!lua name=${library}\nredis.register_function('${library}fn', function() return 1 end)`;

for (const { name, opts } of RESP_CONFIGS) {
  describe(`function (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("7.0.0")) {
        this.skip();
      }
    });

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.function("FLUSH");
    });

    afterEach(async () => {
      await redis.function("FLUSH");
      redis.disconnect();
    });

    it("LOAD returns the library name", async () => {
      expect(await redis.function("LOAD", code)).to.equal(library);
    });

    it("LIST returns an entry per loaded library", async () => {
      await redis.function("LOAD", code);

      const reply = (await redis.function("LIST")) as unknown[];

      expect(reply).to.be.an("array");
      expect(reply).to.have.lengthOf(1);
    });

    it("DELETE removes a loaded library", async () => {
      await redis.function("LOAD", code);

      expect(await redis.function("DELETE", library)).to.equal("OK");
    });
  });
}
