import Redis from "../../../lib/Redis";
import { expect } from "chai";

const STREAM_DELETION_REPLY_CODES = {
  NOT_FOUND: -1,
  DELETED: 1,
  DANGLING_REFS: 2,
} as const;

// TODO unskip once we have a mechanism to run only on specific versions
// TODO as these tests can only work against 8.2 or higher
describe.skip("xdelex", () => {
  let redis: Redis;

  beforeEach(() => {
    redis = new Redis();
  });

  afterEach(() => {
    redis.disconnect();
  });

  it("should handle non-existing key - without policy", async () => {
    const reply = await redis.xdelex("stream-key", "IDS", 1, "0-0");
    expect(reply).to.deep.equal([STREAM_DELETION_REPLY_CODES.NOT_FOUND]);
  });

  it("should handle existing key - without policy", async () => {
    const streamKey = "stream-key";
    const messageId = await redis.xadd(streamKey, "*", "field", "value");

    const reply = await redis.xdelex(streamKey, "IDS", 1, messageId as string);
    expect(reply).to.deep.equal([STREAM_DELETION_REPLY_CODES.DELETED]);
  });

  it("should handle existing key - with DELREF policy", async () => {
    const streamKey = "stream-key";
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
    const streamKey = "stream-key";

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
    const streamKey = "stream-key";
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
