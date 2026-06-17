import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`acl (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("6.0.0")) {
        this.skip();
      }
    });

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("WHOAMI returns the current user", async () => {
      expect(await redis.acl("WHOAMI")).to.equal("default");
    });

    it("LIST includes the default user", async () => {
      const rules = (await redis.acl("LIST")) as string[];

      expect(rules).to.be.an("array");
      expect(rules.some((rule) => rule.startsWith("user default"))).to.equal(
        true
      );
    });

    it("USERS includes the default user", async () => {
      const users = (await redis.acl("USERS")) as string[];

      expect(users).to.include("default");
    });

    it("GENPASS returns a hex-encoded password", async () => {
      const password = await redis.acl("GENPASS");

      expect(password).to.be.a("string");
      expect(password).to.match(/^[0-9a-f]+$/);
    });

    it("CAT returns the available categories", async () => {
      const categories = (await redis.acl("CAT")) as string[];

      expect(categories).to.be.an("array");
      expect(categories).to.include("read");
    });

    it("SETUSER and DELUSER manage a user", async () => {
      const user = `ioredis_acl_${Date.now()}`;

      expect(await redis.acl("SETUSER", user, "on", "nopass")).to.equal("OK");
      expect(await redis.acl("DELUSER", user)).to.equal(1);
    });
  });
}
