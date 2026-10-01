import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan } from "../../helpers/util";

const STREAM_DELETION_REPLY_CODES = {
  NOT_FOUND: -1,
  DELETED: 1,
  DANGLING_REFS: 2,
} as const;

for (const { name, opts } of RESP_CONFIGS) {
  describe(`xdelex (${name})`, function () {
    let redis: Redis;

    beforeEach(async function () {
      if (await isRedisVersionLowerThan("8.2")) {
        this.skip();
      }
      redis = new Redis(opts);
      await redis.flushdb();
    });

    afterEach(() => {
      if (redis) {
        redis.disconnect();
      }
    });

    it("should handle non-existing key - without policy", async () => {
      const streamKey = `xdelex:${Date.now()}`;
      const reply = await redis.xdelex(streamKey, "IDS", 1, "0-0");
      expect(reply).to.deep.equal([STREAM_DELETION_REPLY_CODES.NOT_FOUND]);
    });

    it("should handle existing key - without policy", async () => {
      const streamKey = `xdelex:${Date.now()}`;
      const messageId = await redis.xadd(streamKey, "*", "field", "value");

      const reply = await redis.xdelex(
        streamKey,
        "IDS",
        1,
        messageId as string
      );
      expect(reply).to.deep.equal([STREAM_DELETION_REPLY_CODES.DELETED]);
    });

    it("should handle existing key - with DELREF policy", async () => {
      const streamKey = `xdelex:${Date.now()}`;
      const messageId = await redis.xadd(streamKey, "*", "field", "value");

      const reply = await redis.xdelex(
        streamKey,
        "DELREF",
        "IDS",
        1,
        messageId as string
      );
      expect(reply).to.deep.equal([STREAM_DELETION_REPLY_CODES.DELETED]);
    });

    it("should handle ACKED policy - with consumer group", async () => {
      const streamKey = `xdelex:${Date.now()}`;

      // Add a message to the stream
      const messageId = await redis.xadd(streamKey, "*", "field", "value");

      // Create consumer group
      await redis.xgroup("CREATE", streamKey, "testgroup", "0");

      const reply = await redis.xdelex(
        streamKey,
        "ACKED",
        "IDS",
        1,
        messageId as string
      );
      expect(reply).to.deep.equal([STREAM_DELETION_REPLY_CODES.DANGLING_REFS]);
    });

    it("should handle multiple keys", async () => {
      const streamKey = `xdelex:${Date.now()}`;
      const [messageId, messageId2] = await Promise.all([
        redis.xadd(streamKey, "*", "field", "value1"),
        redis.xadd(streamKey, "*", "field", "value2"),
      ]);

      const reply = await redis.xdelex(
        streamKey,
        "DELREF",
        "IDS",
        3,
        messageId as string,
        messageId2 as string,
        "0-0"
      );
      expect(reply).to.deep.equal([
        STREAM_DELETION_REPLY_CODES.DELETED,
        STREAM_DELETION_REPLY_CODES.DELETED,
        STREAM_DELETION_REPLY_CODES.NOT_FOUND,
      ]);
    });
  });
}
