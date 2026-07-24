import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`scan (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns a cursor and an empty element list on an empty database", async () => {
      expect(await redis.scan(0)).to.eql(["0", []]);
    });

    it("returns a cursor and the matching keys", async () => {
      const prefix = `scan:${Date.now()}`;
      await redis.set(`${prefix}:a`, "value");
      await redis.set(`${prefix}:b`, "value");

      const [cursor, elements] = await redis.scan(0, "MATCH", `${prefix}:*`);
      expect(cursor).to.equal("0");
      expect(elements.sort()).to.eql([`${prefix}:a`, `${prefix}:b`]);
    });
  });
}
