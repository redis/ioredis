import { expect } from "chai";
import Redis from "../../lib/Redis";

// Example structure for mock-based blocking timeout tests
import * as sinon from "sinon";
import MockServer from "../helpers/mock_server";

describe("blockingTimeout with MockServer", () => {
  describe("timeout behavior", () => {
    it("rejects with 'Blocking command timed out' when server hangs", (done) => {
      let connectionCount = 0;

      const server = new MockServer(30001, async (argv, socket, flags) => {
        if (argv[0] === "blpop") {
          flags.hang = true;
          return;
        }
      });

      const redis = new Redis({
        port: 30001,
        blockingTimeout: 50,
      });

      redis.on("connect", () => {
        connectionCount++;
      });

      redis.on("error", () => {});

      redis.blpop("test-list", 0).catch((err) => {
        expect(err.message).to.include("Blocking command timed out");
        redis.once("ready", () => {
          expect(connectionCount).to.equal(2); // Should reconnect
          redis.disconnect();
          server.disconnect(() => done());
        });
      });
    });

    it("non-blocking commands are not affected by blockingTimeout", async () => {
      const server = new MockServer(30001, async (argv, socket, flags) => {
        if (argv[0] === "get") {
          flags.hang = true;
          return;
        }
      });

      const redis = new Redis({
        port: 30001,
        blockingTimeout: 10,
      });

      const result = await Promise.race([
        redis.get("test-key"),
        new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
      ]);

      expect(result).to.equal("timeout");
      redis.disconnect();
      server.disconnect();
    });

    it("does not leak timers when blocking command succeeds", async () => {
      const server = new MockServer(30001, (argv) => {
        if (argv[0] === "blpop") {
          return ["test-list", "value"]; // Respond immediately
        }
      });

      const redis = new Redis({ port: 30001, blockingTimeout: 1000 });
      const clock = sinon.useFakeTimers();

      await redis.blpop("test-list", 0);

      expect(clock.countTimers()).to.equal(0); // No lingering timers
      clock.restore();
      redis.disconnect();
      server.disconnect();
    });

    it("each blocking command has independent timeout", (done) => {
      let blpopCount = 0;
      const server = new MockServer(30001, (argv, socket, flags) => {
        if (argv[0] === "blpop") {
          blpopCount++;
          flags.hang = true;
        }
      });

      const clock = sinon.useFakeTimers();

      const redis = new Redis({ port: 30001, blockingTimeout: 50 });
      redis.on("error", () => {});

      redis.blpop("list1", 0).catch(() => {});
      redis.blpop("list2", 0).catch(() => {});

      expect(clock.countTimers()).to.equal(2);

      clock.restore();
      redis.disconnect();
      server.disconnect(() => done());
    });

    it("server error does not trigger blockingTimeout reconnect", async () => {
      let connectionCount = 0;
      const server = new MockServer(30001, (argv) => {
        if (argv[0] === "blpop") {
          return new Error("WRONGTYPE Operation against a key");
        }
      });

      const redis = new Redis({ port: 30001, blockingTimeout: 100 });
      redis.on("connect", () => connectionCount++);

      try {
        await redis.blpop("not-a-list", 0);
      } catch (err: any) {
        expect(err.message).to.include("WRONGTYPE");
      }

      expect(connectionCount).to.equal(1); // No reconnection
      expect(redis.status).to.equal("ready");
      redis.disconnect();
      server.disconnect();
    });

    it("destroys stream with correct error on timeout", (done) => {
      const server = new MockServer(30001, (argv, socket, flags) => {
        if (argv[0] === "blpop") {
          flags.hang = true;
        }
      });

      const redis = new Redis({ port: 30001, blockingTimeout: 50 });

      redis.on("error", (err) => {
        expect(err.message).to.equal(
          "Blocking command timed out - reconnecting"
        );
        redis.disconnect();
        server.disconnect(() => done());
      });

      redis.blpop("list", 0).catch(() => {}); // Handle rejection
    });
  });
});

describe("blockingTimeout with Redis", function () {
  this.timeout(15000);

  let redis: Redis;
  let pusher: Redis;

  beforeEach(() => {
    redis = new Redis({ lazyConnect: true });
    pusher = new Redis();
  });

  afterEach(() => {
    redis.disconnect();
    pusher.disconnect();
  });

  describe("basic functionality", () => {
    it("does not timeout when data arrives before blockingTimeout", async () => {
      redis = new Redis({ blockingTimeout: 5000 });

      // Push data after a short delay
      setTimeout(() => {
        pusher.lpush("test-list", "value");
      }, 100);

      const result = await redis.blpop("test-list", 10);
      expect(result).to.deep.equal(["test-list", "value"]);
    });

    it("does not timeout when command has its own timeout and resolves", async () => {
      redis = new Redis({ blockingTimeout: 5000 });

      // Push data after a short delay
      setTimeout(() => {
        pusher.lpush("test-list-2", "value");
      }, 100);

      // blpop with 2 second timeout
      const result = await redis.blpop("test-list-2", 2);
      expect(result).to.deep.equal(["test-list-2", "value"]);
    });

    it("returns null when Redis command timeout expires (not blockingTimeout)", async () => {
      redis = new Redis({ blockingTimeout: 5000 });

      // blpop with 1 second timeout - should return null, not throw
      const result = await redis.blpop("nonexistent-list", 1);
      expect(result).to.be.null;
    });
  });
  describe("reconnection behavior", () => {
    it("reconnects after blockingTimeout", (done) => {
      let connectCount = 0;

      redis = new Redis({
        blockingTimeout: 10,
      });

      redis.on("connect", () => {
        connectCount++;
        if (connectCount === 2) {
          redis.disconnect();
          done();
        }
      });

      redis.on("error", () => {});

      redis.blpop("nonexistent-list", 0).catch(() => {});
    });
  });
});
