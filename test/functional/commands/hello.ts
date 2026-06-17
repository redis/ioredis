import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { toRecord } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`hello (${name})`, () => {
    let redis: Redis;

    beforeEach(async () => {
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("returns the handshake information for the negotiated protocol", async () => {
      const record = toRecord(await redis.hello());

      expect(record.server).to.equal("redis");
      expect(record.proto).to.equal(opts.protocol);
      expect(record.id).to.be.a("number");
    });

    it("switches to the requested protocol version", async () => {
      const record = toRecord(await redis.hello(opts.protocol));

      expect(record.proto).to.equal(opts.protocol);
    });
  });
}
