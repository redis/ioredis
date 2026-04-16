import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";


function normalizeGcraReply(reply: Awaited<ReturnType<Redis["gcra"]>>) {
  return {
    limited: reply[0],
    totalLimit: reply[1],
    remaining: reply[2],
    retryAfter: reply[3],
    resetAfter: reply[4]
  };
}

describe("gcra", function () {
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

  it("should allow one request then limit the next with zero burst", async () => {
    const key = `test_gcra_single_token_${Date.now()}`;
    const first = normalizeGcraReply(await redis.gcra(key, 0, 1, 1));
    const second = normalizeGcraReply(await redis.gcra(key, 0, 1, 1));

    expect(first.limited).to.not.equal(second.limited);
    expect(first.retryAfter === -1 || second.retryAfter === -1).to.equal(true);
    expect(first.retryAfter >= 0 || second.retryAfter >= 0).to.equal(true);
  });

  it("should support weighted requests using NUM_REQUESTS", async () => {
    const key = `test_gcra_weighted_${Date.now()}`;
    const first = normalizeGcraReply(
      await redis.gcra(key, 10, 10, 1, "NUM_REQUESTS", 10),
    );
    const second = normalizeGcraReply(
      await redis.gcra(key, 10, 10, 1, "NUM_REQUESTS", 10),
    );

    expect(first.limited).to.not.equal(second.limited);
  });
});
