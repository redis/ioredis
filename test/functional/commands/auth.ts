import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

// The default test server has no password configured, so AUTH without a user
// would error. We provision a throwaway ACL user (requires Redis >= 6) and
// authenticate as that user to exercise the happy path, then clean it up.
for (const { name, opts } of RESP_CONFIGS) {
  describe(`auth (${name})`, function () {
    let redis: Redis;
    const user = `ioredis_auth_${Date.now()}`;
    const password = "ioredis_auth_password";

    before(async function () {
      if (await isRedisVersionLowerThan("6.0.0")) {
        this.skip();
      }
    });

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.acl(
        "SETUSER",
        user,
        "on",
        `>${password}`,
        "~*",
        "+@all"
      );
    });

    afterEach(async () => {
      await redis.acl("DELUSER", user);
      redis.disconnect();
    });

    it("returns OK with username and password", async () => {
      expect(await redis.auth(user, password)).to.equal("OK");
    });
  });
}
