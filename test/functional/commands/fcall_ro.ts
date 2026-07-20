import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

const library = "ioredisfcallrocmd";
const fn = `${library}fn`;
// no-writes is required for a function to be callable via FCALL_RO.
const code = `#!lua name=${library}\nredis.register_function{function_name='${fn}', callback=function() return 1 end, flags={'no-writes'}}`;

for (const { name, opts } of RESP_CONFIGS) {
  describe(`fcall_ro (${name})`, function () {
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

    it("calls a loaded read-only function and returns its result", async () => {
      expect(await redis.fcall_ro(fn, 0)).to.equal(1);
    });
  });
}
