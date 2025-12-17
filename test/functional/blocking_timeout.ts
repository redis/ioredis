import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import Command from "../../lib/Command";
import { Condition } from "../../lib/DataHandler";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

chai.use(chaiAsPromised);
const { expect } = chai;

describe("blocking command recovery", function () {
  this.timeout(10000);

  it("resolves blocking command with null when timeout elapses without a reply", async () => {
    // When a blocking command times out (e.g., due to undetectable network failure
    // or server not responding), it should resolve with null (same as Redis behavior)
    const server = new MockServer(30001, (argv, _socket, flags) => {
      if (argv[0] === "blpop") {
        // Server hangs and never responds
        flags.hang = true;
        return;
      }
    });

    const redis = new Redis({ port: 30001 });
    redis.on("error", () => {});

    try {
      const result = await redis.blpop("queue", 0.1);
      // Should resolve with null after timeout + grace period
      expect(result).to.be.null;
    } finally {
      redis.disconnect();
      await server.disconnectPromise();
    }
  });

  it("uses blockingTimeout option for commands that block forever", async () => {
    let connectCount = 0;

    const server = new MockServer(30001, (argv, _socket, flags) => {
      if (argv[0] === "blpop") {
        flags.hang = true;
      }
    });

    const redis = new Redis({ port: 30001, blockingTimeout: 50 });
    redis.on("error", () => {});
    redis.on("connect", () => connectCount++);

    const pending = redis.blpop("queue", 0);

    try {
      // Command should resolve with null after blockingTimeout deadline
      // (same behavior as Redis when a blocking command times out)
      const result = await pending;
      expect(result).to.be.null;
      // At least one reconnection attempt should have been made
      expect(connectCount).to.be.at.least(1);
    } finally {
      redis.disconnect();
      await server.disconnectPromise();
    }
  });

  it("detects BLOCK durations for xread commands and resolves with null on timeout", async () => {
    const server = new MockServer(30001, (argv, _socket, flags) => {
      if (argv[0] === "xread") {
        // Server hangs and never responds
        flags.hang = true;
        return;
      }
    });

    const redis = new Redis({ port: 30001 });
    redis.on("error", () => {});

    try {
      const result = await redis.xread(
        "BLOCK",
        50,
        "STREAMS",
        "demo-stream",
        "0-0"
      );

      // Should resolve with null after timeout + grace period
      expect(result).to.be.null;
    } finally {
      redis.disconnect();
      await server.disconnectPromise();
    }
  });

  it("arms blocking timer for finite-timeout commands in offline queue", async () => {
    // Now that we have protection against commands stuck in offline queue,
    // we DO arm the timer when a blocking command with finite timeout enters offline queue
    const originalSetter = Command.prototype.setBlockingTimeout;
    let timerCalls = 0;
    Command.prototype.setBlockingTimeout = function (
      this: Command,
      ...args: Parameters<typeof originalSetter>
    ) {
      timerCalls += 1;
      return originalSetter.apply(this, args);
    };

    const redis = new Redis({ lazyConnect: true });
    redis.on("error", () => {});
    redis.connect = async () => {
      /* no-op to keep connection in wait state */
    };
    redis.condition = {
      select: redis.options.db ?? 0,
      auth: undefined,
      subscriber: false,
    } as Condition;

    const pending = redis.blpop("queue", 0.1);
    pending.catch(() => {});

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Timer should be armed for finite-timeout blocking commands in offline queue
      expect(timerCalls).to.equal(1);
    } finally {
      Command.prototype.setBlockingTimeout = originalSetter;
      redis.disconnect();
    }
  });

  it("does not arm timer for infinite blocking commands without blockingTimeout option", async () => {
    // For commands that block forever (timeout 0), we should NOT arm a timer
    // unless blockingTimeout option is configured
    const originalSetter = Command.prototype.setBlockingTimeout;
    let timerCalls = 0;
    Command.prototype.setBlockingTimeout = function (
      this: Command,
      ...args: Parameters<typeof originalSetter>
    ) {
      timerCalls += 1;
      return originalSetter.apply(this, args);
    };

    const redis = new Redis({ lazyConnect: true });
    redis.on("error", () => {});
    redis.connect = async () => {
      /* no-op to keep connection in wait state */
    };
    redis.condition = {
      select: redis.options.db ?? 0,
      auth: undefined,
      subscriber: false,
    } as Condition;

    // Block forever (0 timeout) - should NOT arm timer without blockingTimeout option
    const pending = redis.blpop("queue", 0);
    pending.catch(() => {});

    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Timer should NOT be armed for infinite blocking commands without blockingTimeout
      expect(timerCalls).to.equal(0);
    } finally {
      Command.prototype.setBlockingTimeout = originalSetter;
      redis.disconnect();
    }
  });

  it("resolves blocking command stuck in offline queue with null after blockingTimeout", async () => {
    // This simulates the scenario where:
    // 1. TCP connection succeeds (connect event fires)
    // 2. But no data can flow (e.g., docker network disconnect)
    // 3. Connection never becomes "ready"
    // 4. Command sits in offline queue forever
    // The blockingTimeout should resolve the command with null when stuck in offline queue

    const server = new MockServer(30001, (_argv, _socket, flags) => {
      // Never respond to any command - simulates network black hole
      flags.hang = true;
    });

    const redis = new Redis({
      port: 30001,
      blockingTimeout: 100,
      // Disable retry to make test deterministic
      retryStrategy: () => null,
    });
    redis.on("error", () => {});

    try {
      const start = Date.now();
      const pending = redis.blpop("queue", 0);

      // Command should resolve with null after blockingTimeout even though it's stuck
      // in the offline queue (connection never becomes ready because server hangs)
      const result = await pending;
      expect(result).to.be.null;

      const elapsed = Date.now() - start;
      // Should resolve within reasonable time of blockingTimeout (100ms + some buffer)
      expect(elapsed).to.be.lessThan(500);
    } finally {
      redis.disconnect();
      await server.disconnectPromise();
    }
  });

  it("resolves blocking command with finite timeout stuck in offline queue with null", async () => {
    // Even commands with finite Redis timeouts should eventually resolve with null
    // if they're stuck in the offline queue due to network issues

    const server = new MockServer(30001, (_argv, _socket, flags) => {
      // Never respond to any command - simulates network black hole
      flags.hang = true;
    });

    const redis = new Redis({
      port: 30001,
      blockingTimeout: 100, // Safety net for all blocking commands
      retryStrategy: () => null,
    });
    redis.on("error", () => {});

    try {
      const start = Date.now();
      // Command has 5 second Redis timeout, but blockingTimeout should kick in
      const pending = redis.blpop("queue", 5);

      // Should resolve with null by blockingTimeout since command is stuck offline
      const result = await pending;
      expect(result).to.be.null;

      const elapsed = Date.now() - start;
      // Should resolve within reasonable time, not wait for the 5 second Redis timeout
      expect(elapsed).to.be.lessThan(500);
    } finally {
      redis.disconnect();
      await server.disconnectPromise();
    }
  });
});
