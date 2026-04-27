import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";

describe("xnack", function () {
  before(async function () {
    if (await isRedisVersionLowerThan("8.7")) {
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

  async function createStreamEntry(
    streamKey: string,
    group: string
  ): Promise<string> {
    const messageId = (await redis.xadd(
      streamKey,
      "*",
      "field",
      "value"
    )) as string;

    await redis.xgroup("CREATE", streamKey, group, "0");

    return messageId;
  }

  async function createPendingEntry(
    streamKey: string,
    group: string
  ): Promise<string> {
    const messageId = await createStreamEntry(streamKey, group);

    await redis.xreadgroup(
      "GROUP",
      group,
      "consumer-1",
      "STREAMS",
      streamKey,
      ">"
    );

    return messageId;
  }

  it("should return a number with FAIL", async () => {
    const streamKey = "xnack-fail";
    const group = "group-fail";
    const messageId = await createPendingEntry(streamKey, group);

    const reply = await redis.xnack(
      streamKey,
      group,
      "FAIL",
      "IDS",
      1,
      messageId
    );

    expect(reply).to.be.a("number");
  });

  it("should return a number with SILENT", async () => {
    const streamKey = "xnack-silent";
    const group = "group-silent";
    const messageId = await createPendingEntry(streamKey, group);

    const reply = await redis.xnack(
      streamKey,
      group,
      "SILENT",
      "IDS",
      1,
      messageId
    );

    expect(reply).to.be.a("number");
  });

  it("should return a number with FATAL", async () => {
    const streamKey = "xnack-fatal";
    const group = "group-fatal";
    const messageId = await createPendingEntry(streamKey, group);

    const reply = await redis.xnack(
      streamKey,
      group,
      "FATAL",
      "IDS",
      1,
      messageId
    );

    expect(reply).to.be.a("number");
  });

  it("should return a number with RETRYCOUNT", async () => {
    const streamKey = "xnack-retrycount";
    const group = "group-retrycount";
    const messageId = await createPendingEntry(streamKey, group);

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

    expect(reply).to.be.a("number");
  });

  it("should return a number with FORCE", async () => {
    const streamKey = "xnack-force";
    const group = "group-force";
    const messageId = await createStreamEntry(streamKey, group);

    const reply = await redis.xnack(
      streamKey,
      group,
      "FAIL",
      "IDS",
      1,
      messageId,
      "FORCE"
    );

    expect(reply).to.be.a("number");
  });

  it("should return a number with RETRYCOUNT and FORCE", async () => {
    const streamKey = "xnack-retrycount-force";
    const group = "group-retrycount-force";
    const messageId = await createStreamEntry(streamKey, group);

    const reply = await redis.xnack(
      streamKey,
      group,
      "FAIL",
      "IDS",
      1,
      messageId,
      "RETRYCOUNT",
      7,
      "FORCE"
    );

    expect(reply).to.be.a("number");
  });

  it("should return a number with multiple IDs", async () => {
    const streamKey = "xnack-multiple-ids";
    const group = "group-multiple-ids";
    const firstId = await createPendingEntry(streamKey, group);
    const secondId = (await redis.xadd(
      streamKey,
      "*",
      "field",
      "value-2"
    )) as string;

    await redis.xreadgroup(
      "GROUP",
      group,
      "consumer-1",
      "STREAMS",
      streamKey,
      ">"
    );

    const reply = await redis.xnack(
      streamKey,
      group,
      "FAIL",
      "IDS",
      2,
      firstId,
      secondId
    );

    expect(reply).to.be.a("number");
  });
});
