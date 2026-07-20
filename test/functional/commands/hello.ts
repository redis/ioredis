import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";

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
      const reply = await redis.hello();
      const expectedType: Record<ReplyMapping, string> = {
        legacy: "array",
        resp3: "object",
      };
      const expectedIsArray: Record<ReplyMapping, boolean> = {
        legacy: true,
        resp3: false,
      };
      const legacyReply = Array.isArray(reply) ? reply : [];
      const expectedServer: Record<ReplyMapping, unknown> = {
        legacy: legacyReply[legacyReply.indexOf("server") + 1],
        resp3: (reply as Record<string, unknown>).server,
      };
      const expectedProto: Record<ReplyMapping, unknown> = {
        legacy: legacyReply[legacyReply.indexOf("proto") + 1],
        resp3: (reply as Record<string, unknown>).proto,
      };
      const expectedId: Record<ReplyMapping, unknown> = {
        legacy: legacyReply[legacyReply.indexOf("id") + 1],
        resp3: (reply as Record<string, unknown>).id,
      };

      expect(reply).to.be.an(expectedType[opts.replyMapping]);
      expect(Array.isArray(reply)).to.equal(expectedIsArray[opts.replyMapping]);
      expect(expectedServer[opts.replyMapping]).to.equal("redis");
      expect(expectedProto[opts.replyMapping]).to.equal(opts.protocol);
      expect(expectedId[opts.replyMapping]).to.be.a("number");
    });

    it("switches to the requested protocol version", async () => {
      const reply = await redis.hello(opts.protocol);
      const expectedType: Record<ReplyMapping, string> = {
        legacy: "array",
        resp3: "object",
      };
      const expectedIsArray: Record<ReplyMapping, boolean> = {
        legacy: true,
        resp3: false,
      };
      const legacyReply = Array.isArray(reply) ? reply : [];
      const expectedProto: Record<ReplyMapping, unknown> = {
        legacy: legacyReply[legacyReply.indexOf("proto") + 1],
        resp3: (reply as Record<string, unknown>).proto,
      };

      expect(reply).to.be.an(expectedType[opts.replyMapping]);
      expect(Array.isArray(reply)).to.equal(expectedIsArray[opts.replyMapping]);
      expect(expectedProto[opts.replyMapping]).to.equal(opts.protocol);
    });
  });
}
