import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";

describe("xnack", function () {
  before(async function () {
    if (await isRedisVersionLowerThan("8.8")) {
      this.skip();
    }
  });

  let redis: Redis;

  beforeEach(() => {
    redis = new Redis();
  });

  afterEach(() => {
    redis.disconnect();
  });

  async function createPendingEntry(
    streamKey: string,
    group: string,
    consumer = "consumer-1"
  ): Promise<string> {
    const messageId = (await redis.xadd(
      streamKey,
      "*",
      "field",
      "value"
    )) as string;

    await redis.xgroup("CREATE", streamKey, group, "0");
    await redis.xreadgroup("GROUP", group, consumer, "STREAMS", streamKey, ">");
    await redis.xreadgroup("GROUP", group, consumer, "STREAMS", streamKey, "0");

    return messageId;
  }

  it("releases a pending entry with FAIL and keeps the delivery count unchanged", async () => {
    const streamKey = "stream-key";
    const group = "group";
    const messageId = await createPendingEntry(streamKey, group);

    const before = await redis.xpending(streamKey, group, "-", "+", 1);
    expect(before).to.have.length(1);
    expect(before[0][0]).to.equal(messageId);
    expect(before[0][1]).to.equal("consumer-1");
    expect(before[0][3]).to.equal(2);

    const reply = await redis.xnack(
      streamKey,
      group,
      "FAIL",
      "IDS",
      1,
      messageId
    );

    expect(reply).to.equal(1);

    const summary = await redis.xpending(streamKey, group);
    expect(summary[0]).to.equal(1);
    expect(summary[1]).to.equal(messageId);
    expect(summary[2]).to.equal(messageId);
    expect(summary[3]).to.deep.equal([]);

    const after = await redis.xpending(streamKey, group, "-", "+", 1);
    expect(after).to.have.length(1);
    expect(after[0][0]).to.equal(messageId);
    expect(after[0][1]).to.equal("");
    expect(after[0][3]).to.equal(2);
  });

  it("decrements the delivery count with SILENT", async () => {
    const streamKey = "stream-key";
    const group = "group";
    const messageId = await createPendingEntry(streamKey, group);

    const before = await redis.xpending(streamKey, group, "-", "+", 1);
    expect(before).to.have.length(1);
    expect(before[0][0]).to.equal(messageId);
    expect(before[0][1]).to.equal("consumer-1");
    expect(before[0][3]).to.equal(2);

    const reply = await redis.xnack(
      streamKey,
      group,
      "SILENT",
      "IDS",
      1,
      messageId
    );

    expect(reply).to.equal(1);

    const summary = await redis.xpending(streamKey, group);
    expect(summary[0]).to.equal(1);
    expect(summary[1]).to.equal(messageId);
    expect(summary[2]).to.equal(messageId);
    expect(summary[3]).to.deep.equal([]);

    const after = await redis.xpending(streamKey, group, "-", "+", 1);
    expect(after).to.have.length(1);
    expect(after[0][0]).to.equal(messageId);
    expect(after[0][1]).to.equal("");
    expect(after[0][3]).to.equal(1);
  });

  it("sets the delivery count to 9223372036854775807 with FATAL", async () => {
    const streamKey = "stream-key";
    const group = "group";
    const messageId = await createPendingEntry(streamKey, group);

    const before = await redis.xpending(streamKey, group, "-", "+", 1);
    expect(before).to.have.length(1);
    expect(before[0][0]).to.equal(messageId);
    expect(before[0][1]).to.equal("consumer-1");
    expect(before[0][3]).to.equal(2);

    const reply = await redis.xnack(
      streamKey,
      group,
      "FATAL",
      "IDS",
      1,
      messageId
    );

    expect(reply).to.equal(1);

    const summary = await redis.xpending(streamKey, group);
    expect(summary[0]).to.equal(1);
    expect(summary[1]).to.equal(messageId);
    expect(summary[2]).to.equal(messageId);
    expect(summary[3]).to.deep.equal([]);

    const stringNumbersRedis = new Redis({ stringNumbers: true });

    try {
      const details = await stringNumbersRedis.xpending(
        streamKey,
        group,
        "-",
        "+",
        1
      );

      expect(details).to.have.length(1);
      expect(details[0][0]).to.equal(messageId);
      expect(details[0][1]).to.equal("");
      expect(details[0][3]).to.equal("9223372036854775807");
    } finally {
      stringNumbersRedis.disconnect();
    }
  });

  it("overrides the delivery count with RETRYCOUNT", async () => {
    const streamKey = "stream-key";
    const group = "group";
    const messageId = await createPendingEntry(streamKey, group);

    const before = await redis.xpending(streamKey, group, "-", "+", 1);
    expect(before).to.have.length(1);
    expect(before[0][0]).to.equal(messageId);
    expect(before[0][1]).to.equal("consumer-1");
    expect(before[0][3]).to.equal(2);

    const reply = await redis.xnack(
      streamKey,
      group,
      "FAIL",
      "IDS",
      1,
      messageId,
      "RETRYCOUNT",
      7
    );

    expect(reply).to.equal(1);

    const summary = await redis.xpending(streamKey, group);
    expect(summary[0]).to.equal(1);
    expect(summary[1]).to.equal(messageId);
    expect(summary[2]).to.equal(messageId);
    expect(summary[3]).to.deep.equal([]);

    const after = await redis.xpending(streamKey, group, "-", "+", 1);
    expect(after).to.have.length(1);
    expect(after[0][0]).to.equal(messageId);
    expect(after[0][1]).to.equal("");
    expect(after[0][3]).to.equal(7);
  });

  it("counts only successfully released IDs", async () => {
    const streamKey = "xnack-partial";
    const group = "group-partial";
    const messageId = await createPendingEntry(streamKey, group);

    const reply = await redis.xnack(
      streamKey,
      group,
      "FAIL",
      "IDS",
      2,
      messageId,
      "0-0"
    );

    expect(reply).to.equal(1);

    const summary = await redis.xpending(streamKey, group);
    expect(summary[0]).to.equal(1);
    expect(summary[1]).to.equal(messageId);
    expect(summary[2]).to.equal(messageId);
    expect(summary[3]).to.deep.equal([]);

    const after = await redis.xpending(streamKey, group, "-", "+", 1);
    expect(after).to.have.length(1);
    expect(after[0][0]).to.equal(messageId);
    expect(after[0][1]).to.equal("");
    expect(after[0][3]).to.equal(2);
  });

  it("creates an unowned pending entry with FORCE", async () => {
    const streamKey = "xnack-force";
    const group = "group-force";
    const messageId = (await redis.xadd(
      streamKey,
      "*",
      "field",
      "value"
    )) as string;

    await redis.xgroup("CREATE", streamKey, group, "0");

    const reply = await redis.xnack(
      streamKey,
      group,
      "FAIL",
      "IDS",
      1,
      messageId,
      "FORCE"
    );

    expect(reply).to.equal(1);

    const summary = await redis.xpending(streamKey, group);
    expect(summary[0]).to.equal(1);
    expect(summary[1]).to.equal(messageId);
    expect(summary[2]).to.equal(messageId);
    expect(summary[3]).to.deep.equal([]);

    const after = await redis.xpending(streamKey, group, "-", "+", 1);
    expect(after).to.have.length(1);
    expect(after[0][0]).to.equal(messageId);
    expect(after[0][1]).to.equal("");
    expect(after[0][3]).to.equal(0);
  });

  it("applies RETRYCOUNT when FORCE creates a new pending entry", async () => {
    const streamKey = "xnack-force-retrycount";
    const group = "group-force-retrycount";
    const messageId = (await redis.xadd(
      streamKey,
      "*",
      "field",
      "value"
    )) as string;

    await redis.xgroup("CREATE", streamKey, group, "0");

    const reply = await redis.xnack(
      streamKey,
      group,
      "FAIL",
      "IDS",
      1,
      messageId,
      "RETRYCOUNT",
      9,
      "FORCE"
    );

    expect(reply).to.equal(1);

    const summary = await redis.xpending(streamKey, group);
    expect(summary[0]).to.equal(1);
    expect(summary[1]).to.equal(messageId);
    expect(summary[2]).to.equal(messageId);
    expect(summary[3]).to.deep.equal([]);

    const after = await redis.xpending(streamKey, group, "-", "+", 1);
    expect(after).to.have.length(1);
    expect(after[0][0]).to.equal(messageId);
    expect(after[0][1]).to.equal("");
    expect(after[0][3]).to.equal(9);
  });

  it("returns the released count for batched IDs", async () => {
    const streamKey = "xnack-batch";
    const group = "group-batch";
    const firstId = await createPendingEntry(streamKey, group, "consumer-a");
    const secondId = (await redis.xadd(
      streamKey,
      "*",
      "field",
      "value-2"
    )) as string;

    await redis.xreadgroup(
      "GROUP",
      group,
      "consumer-b",
      "STREAMS",
      streamKey,
      ">"
    );

    const reply = await redis.xnack(
      streamKey,
      group,
      "FAIL",
      "IDS",
      3,
      firstId,
      secondId,
      "0-0"
    );

    expect(reply).to.equal(2);

    const summary = await redis.xpending(streamKey, group);
    expect(summary[0]).to.equal(2);
    expect(summary[3]).to.deep.equal([]);

    const details = await redis.xpending(streamKey, group, "-", "+", 2);
    expect(details).to.have.length(2);
    expect(details[0][0]).to.equal(firstId);
    expect(details[0][1]).to.equal("");
    expect(details[0][3]).to.equal(2);
    expect(details[1][0]).to.equal(secondId);
    expect(details[1][1]).to.equal("");
    expect(details[1][3]).to.equal(1);
  });
});
