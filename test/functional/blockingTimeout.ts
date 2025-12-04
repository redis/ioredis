import { expect } from "chai";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

const BLOCKING_PORT = 30001;
const BLOCKING_FALLBACK_PORT = 30002;

describe("blocking command watchdog", function () {
  this.timeout(10000);

  it("reconnects when a blocking command exceeds its own timeout", async () => {
    let bzpopCalls = 0;
    const server = new MockServer(BLOCKING_PORT, (argv, _socket, flags) => {
      if (argv[0].toLowerCase() === "bzpopmin") {
        bzpopCalls += 1;
        if (bzpopCalls === 1) {
          flags.hang = true;
          return;
        }
        return ["queue", "job", "1"];
      }
    });

    const redis = new Redis({
      port: BLOCKING_PORT,
      lazyConnect: true,
      retryStrategy: () => 0,
    });
    redis.on("error", () => {});
    await redis.connect();

    const startedAt = Date.now();
    const result = await redis.bzpopmin("queue", 1);
    const duration = Date.now() - startedAt;

    expect(result).to.deep.equal(["queue", "job", "1"]);
    expect(bzpopCalls).to.equal(2);
    expect(duration).to.be.gte(1000); // 1s command timeout + grace
    expect(duration).to.be.lt(5000);

    redis.disconnect();
    await server.disconnectPromise();
  });

  it("falls back to blockingConnectionTimeout when command timeout is zero", async () => {
    let bzpopCalls = 0;
    const server = new MockServer(BLOCKING_FALLBACK_PORT, (argv, _socket, flags) => {
      if (argv[0].toLowerCase() === "bzpopmin") {
        bzpopCalls += 1;
        if (bzpopCalls === 1) {
          flags.hang = true;
          return;
        }
        return ["queue", "job", "1"];
      }
    });

    const fallbackTimeoutMs = 200;
    const redis = new Redis({
      port: BLOCKING_FALLBACK_PORT,
      lazyConnect: true,
      retryStrategy: () => 0,
      blockingConnectionTimeout: fallbackTimeoutMs,
    });
    redis.on("error", () => {});
    await redis.connect();

    const startedAt = Date.now();
    const result = await redis.bzpopmin("queue", 0);
    const duration = Date.now() - startedAt;

    expect(result).to.deep.equal(["queue", "job", "1"]);
    expect(bzpopCalls).to.equal(2);
    expect(duration).to.be.gte(fallbackTimeoutMs);
    expect(duration).to.be.lt(3000);

    redis.disconnect();
    await server.disconnectPromise();
  });
});
