import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

const library = "ioredisfcallcmd";
const fn = `${library}fn`;
const code = `#!lua name=${library}\nredis.register_function('${fn}', function() return 1 end)`;

for (const { name, opts } of RESP_CONFIGS) {
  describe(`fcall (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("7.0.0")) {
        this.skip();
      }
    });

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.function("LOAD", "REPLACE", code);
    });

    afterEach(async () => {
      await redis.function("FLUSH");
      redis.disconnect();
    });

    it("calls a loaded function and returns its result", async () => {
      expect(await redis.fcall(fn, 0)).to.equal(1);
    });
  });
}
