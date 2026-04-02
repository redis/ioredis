import Redis from "../../lib/Redis";
import { expect } from "chai";
import { sanitizeArgs } from "../../lib/tracing";

// TracingChannel requires Node >= 20.13. Skip tests on older versions.
const nodeVersion = process.versions.node.split(".").map(Number);
const hasTracingChannel =
  nodeVersion[0] > 20 || (nodeVersion[0] === 20 && nodeVersion[1] >= 13);

const describeOrSkip = hasTracingChannel ? describe : describe.skip;

describeOrSkip("tracing", function () {
  let dc: typeof import("node:diagnostics_channel");

  before(function () {
    dc =
      "getBuiltinModule" in process
        ? (process as any).getBuiltinModule("node:diagnostics_channel")
        : require("node:diagnostics_channel");
  });

  describe("ioredis:command", function () {
    it("should trace a simple command", async function () {
      const events: { name: string; context: any }[] = [];
      const subscriber = {
        start(message: any) {
          events.push({ name: "start", context: message });
        },
        end(message: any) {
          events.push({ name: "end", context: message });
        },
        asyncStart(message: any) {
          events.push({ name: "asyncStart", context: message });
        },
        asyncEnd(message: any) {
          events.push({ name: "asyncEnd", context: message });
        },
        error(message: any) {
          events.push({ name: "error", context: message });
        },
      };

      const channel = dc.tracingChannel("ioredis:command");
      channel.subscribe(subscriber);

      try {
        const redis = new Redis({ lazyConnect: true });
        await redis.connect();
        await redis.set("tracing-test-key", "tracing-test-value");
        const result = await redis.get("tracing-test-key");
        expect(result).to.eql("tracing-test-value");
        redis.disconnect();

        // Filter to only SET and GET (ignore handshake commands like auth, client, info, select)
        const setEvents = events.filter((e) => e.context.command === "set");
        const getEvents = events.filter((e) => e.context.command === "get");

        expect(setEvents.length).to.be.greaterThan(0);
        expect(getEvents.length).to.be.greaterThan(0);

        // Check SET context fields — value is sanitized, key is visible
        const setStart = setEvents.find((e) => e.name === "start");
        expect(setStart).to.exist;
        expect(setStart.context.command).to.eql("set");
        expect(setStart.context.args).to.eql(["tracing-test-key", "?"]);
        expect(setStart.context.database).to.eql(0);
        expect(setStart.context.serverAddress).to.be.a("string");
        expect(setStart.context.batchMode).to.be.undefined;
        expect(setStart.context.batchSize).to.be.undefined;

        // Check GET context fields — all args visible (read-only command)
        const getStart = getEvents.find((e) => e.name === "start");
        expect(getStart).to.exist;
        expect(getStart.context.command).to.eql("get");
        expect(getStart.context.args).to.eql(["tracing-test-key"]);

        // asyncEnd should fire for completed commands
        const setAsyncEnd = setEvents.find((e) => e.name === "asyncEnd");
        expect(setAsyncEnd).to.exist;
      } finally {
        channel.unsubscribe(subscriber);
      }
    });

    it("should include serverPort for TCP connections", async function () {
      const events: any[] = [];
      const subscriber = {
        start(message: any) {
          events.push(message);
        },
        end() {},
        asyncStart() {},
        asyncEnd() {},
        error() {},
      };

      const channel = dc.tracingChannel("ioredis:command");
      channel.subscribe(subscriber);

      try {
        const redis = new Redis({ lazyConnect: true });
        await redis.connect();
        await redis.ping();
        redis.disconnect();

        const pingEvent = events.find((e) => e.command === "ping");
        expect(pingEvent).to.exist;
        expect(pingEvent.serverPort).to.eql(6379);
        expect(pingEvent.serverAddress).to.eql("localhost");
      } finally {
        channel.unsubscribe(subscriber);
      }
    });

    it("should include database number", async function () {
      const events: any[] = [];
      const subscriber = {
        start(message: any) {
          events.push(message);
        },
        end() {},
        asyncStart() {},
        asyncEnd() {},
        error() {},
      };

      const channel = dc.tracingChannel("ioredis:command");
      channel.subscribe(subscriber);

      try {
        const redis = new Redis({ db: 3, lazyConnect: true });
        await redis.connect();
        await redis.ping();
        redis.disconnect();

        const pingEvent = events.find((e) => e.command === "ping");
        expect(pingEvent).to.exist;
        expect(pingEvent.database).to.eql(3);
      } finally {
        channel.unsubscribe(subscriber);
      }
    });

    it("should trace pipeline commands with batchMode and batchSize", async function () {
      const events: any[] = [];
      const subscriber = {
        start(message: any) {
          events.push(message);
        },
        end() {},
        asyncStart() {},
        asyncEnd() {},
        error() {},
      };

      const channel = dc.tracingChannel("ioredis:command");
      channel.subscribe(subscriber);

      try {
        const redis = new Redis({ lazyConnect: true });
        await redis.connect();
        await redis
          .pipeline()
          .set("pipe-key-1", "val1")
          .set("pipe-key-2", "val2")
          .get("pipe-key-1")
          .exec();
        redis.disconnect();

        const pipelineEvents = events.filter((e) => e.batchMode === "PIPELINE");
        expect(pipelineEvents.length).to.eql(3);
        for (const evt of pipelineEvents) {
          expect(evt.batchSize).to.eql(3);
          expect(evt.batchMode).to.eql("PIPELINE");
        }
      } finally {
        channel.unsubscribe(subscriber);
      }
    });

    it("should not emit per-command events for MULTI commands", async function () {
      const commandEvents: any[] = [];
      const commandSubscriber = {
        start(message: any) {
          commandEvents.push(message);
        },
        end() {},
        asyncStart() {},
        asyncEnd() {},
        error() {},
      };

      const channel = dc.tracingChannel("ioredis:command");
      channel.subscribe(commandSubscriber);

      try {
        const redis = new Redis({ lazyConnect: true });
        await redis.connect();
        await redis
          .multi()
          .set("multi-key-1", "val1")
          .get("multi-key-1")
          .exec();
        redis.disconnect();

        // MULTI commands should NOT appear on ioredis:command
        const multiEvents = commandEvents.filter(
          (e) => e.batchMode === "MULTI"
        );
        expect(multiEvents.length).to.eql(0);
      } finally {
        channel.unsubscribe(commandSubscriber);
      }
    });

    it("should not cause unhandled rejections for failed pipeline commands", async function () {
      const errorEvents: any[] = [];
      const subscriber = {
        start() {},
        end() {},
        asyncStart() {},
        asyncEnd() {},
        error(message: any) {
          errorEvents.push(message);
        },
      };

      const channel = dc.tracingChannel("ioredis:command");
      channel.subscribe(subscriber);

      // Track unhandled rejections — the bug would cause one here
      const unhandledRejections: any[] = [];
      const onUnhandled = (reason: any) => unhandledRejections.push(reason);
      process.on("unhandledRejection", onUnhandled);

      try {
        const redis = new Redis({ lazyConnect: true });
        await redis.connect();

        // Set key as string, then pipeline an HSET on it to trigger WRONGTYPE
        await redis.set("pipe-reject-key", "string-value");
        const results = await redis
          .pipeline()
          .hset("pipe-reject-key", "field", "value")
          .get("pipe-reject-key")
          .exec();
        redis.disconnect();

        // Pipeline reports per-command errors in the results, not via rejection
        expect(results[0][0]).to.be.instanceOf(Error);
        expect(results[0][0].message).to.include("WRONGTYPE");

        // Give the event loop a tick for any stray rejections to surface
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(unhandledRejections).to.have.lengthOf(0);

        // The error trace event should still have fired
        const hsetErrors = errorEvents.filter((e) => e.command === "hset");
        expect(hsetErrors.length).to.be.greaterThan(0);
      } finally {
        process.removeListener("unhandledRejection", onUnhandled);
        channel.unsubscribe(subscriber);
      }
    });

    it("should not allocate context when no subscribers", async function () {
      // Just ensure the command works correctly without any subscriber
      const redis = new Redis({ lazyConnect: true });
      await redis.connect();
      await redis.set("no-sub-key", "val");
      const result = await redis.get("no-sub-key");
      expect(result).to.eql("val");
      redis.disconnect();
    });

    it("should not produce duplicate trace events for offline-queued commands", async function () {
      const events: any[] = [];
      const subscriber = {
        start(message: any) {
          events.push(message);
        },
        end() {},
        asyncStart() {},
        asyncEnd() {},
        error() {},
      };

      const channel = dc.tracingChannel("ioredis:command");
      channel.subscribe(subscriber);

      try {
        const redis = new Redis({ lazyConnect: true });
        // Start connecting but don't await — puts Redis in "connecting" state
        const connectPromise = redis.connect();
        // Issue command while still connecting — it goes to the offline queue
        const setPromise = redis.set("offline-key", "offline-value");
        await connectPromise;
        await setPromise;
        redis.disconnect();

        const setEvents = events.filter((e) => e.command === "set");
        // Should trace exactly once, not twice
        expect(setEvents.length).to.eql(1);
      } finally {
        channel.unsubscribe(subscriber);
      }
    });

    it("should trace errors on failed commands", async function () {
      const errorEvents: any[] = [];
      const subscriber = {
        start() {},
        end() {},
        asyncStart() {},
        asyncEnd() {},
        error(message: any) {
          errorEvents.push(message);
        },
      };

      const channel = dc.tracingChannel("ioredis:command");
      channel.subscribe(subscriber);

      try {
        const redis = new Redis({ lazyConnect: true });
        await redis.connect();
        // Set key as string, then HSET on it to trigger WRONGTYPE error
        await redis.set("tracing-error-key", "string-value");
        try {
          await redis.hset("tracing-error-key", "field", "value");
        } catch {
          // Expected WRONGTYPE error
        }
        redis.disconnect();

        expect(errorEvents.length).to.be.greaterThan(0);
        const errorContext = errorEvents[0];
        expect(errorContext).to.have.property("command");
        expect(errorContext).to.have.property("serverAddress");
        expect(errorContext).to.have.property("serverPort");
      } finally {
        channel.unsubscribe(subscriber);
      }
    });
  });

  describe("sanitizeArgs", function () {
    // args=0: command name only
    it("should redact all args for ECHO", function () {
      expect(sanitizeArgs("echo", ["hello world"])).to.eql(["?"]);
      expect(sanitizeArgs("ECHO", ["hello world"])).to.eql(["?"]);
    });

    // args=1: key only
    it("should keep key but redact value for SET", function () {
      expect(sanitizeArgs("set", ["mykey", "secret"])).to.eql(["mykey", "?"]);
      expect(sanitizeArgs("SET", ["mykey", "secret"])).to.eql(["mykey", "?"]);
    });

    it("should keep key but redact value for SET with flags", function () {
      expect(sanitizeArgs("set", ["key", "secret", "EX", "300", "NX"])).to.eql([
        "key",
        "?",
        "?",
        "?",
        "?",
      ]);
    });

    it("should keep key but redact value for SETEX (prefix match on SET)", function () {
      expect(sanitizeArgs("setex", ["key", "300", "secret"])).to.eql([
        "key",
        "?",
        "?",
      ]);
    });

    it("should keep key but redact values for LPUSH with multiple elements", function () {
      expect(sanitizeArgs("lpush", ["mylist", "a", "b", "c"])).to.eql([
        "mylist",
        "?",
        "?",
        "?",
      ]);
    });

    it("should keep key but redact message for PUBLISH", function () {
      expect(sanitizeArgs("publish", ["channel", "secret message"])).to.eql([
        "channel",
        "?",
      ]);
    });

    it("should keep key but redact values for MSET", function () {
      expect(sanitizeArgs("mset", ["k1", "v1", "k2", "v2"])).to.eql([
        "k1",
        "?",
        "?",
        "?",
      ]);
    });

    it("should keep key but redact member and score for ZADD", function () {
      expect(sanitizeArgs("zadd", ["myzset", "1", "member1"])).to.eql([
        "myzset",
        "?",
        "?",
      ]);
    });

    it("should keep key but redact fields and values for XADD", function () {
      expect(sanitizeArgs("xadd", ["stream", "*", "field", "value"])).to.eql([
        "stream",
        "?",
        "?",
        "?",
      ]);
    });

    // args=2: key + field
    it("should keep key and field but redact value for HSET", function () {
      expect(sanitizeArgs("hset", ["hash", "field", "secret"])).to.eql([
        "hash",
        "field",
        "?",
      ]);
    });

    it("should keep key and field but redact remaining for HMSET", function () {
      expect(sanitizeArgs("hmset", ["hash", "f1", "v1", "f2", "v2"])).to.eql([
        "hash",
        "f1",
        "?",
        "?",
        "?",
      ]);
    });

    it("should keep key and index but redact value for LSET", function () {
      expect(sanitizeArgs("lset", ["mylist", "0", "newvalue"])).to.eql([
        "mylist",
        "0",
        "?",
      ]);
    });

    it("should keep key and pivot position for LINSERT", function () {
      expect(
        sanitizeArgs("linsert", ["mylist", "BEFORE", "pivot", "newvalue"])
      ).to.eql(["mylist", "BEFORE", "?", "?"]);
    });

    // args=-1: all args visible
    it("should show all args for GET", function () {
      expect(sanitizeArgs("get", ["mykey"])).to.eql(["mykey"]);
      expect(sanitizeArgs("GET", ["mykey"])).to.eql(["mykey"]);
    });

    it("should show all args for DEL", function () {
      expect(sanitizeArgs("del", ["k1", "k2", "k3"])).to.eql([
        "k1",
        "k2",
        "k3",
      ]);
    });

    it("should show all args for SUBSCRIBE", function () {
      expect(sanitizeArgs("subscribe", ["ch1", "ch2"])).to.eql(["ch1", "ch2"]);
    });

    it("should show all args for CONFIG GET", function () {
      expect(sanitizeArgs("config", ["GET", "maxmemory"])).to.eql([
        "GET",
        "maxmemory",
      ]);
    });

    it("should show all args for EVAL", function () {
      expect(sanitizeArgs("eval", ["return 1", "0"])).to.eql(["return 1", "0"]);
    });

    it("should show all args for HMGET", function () {
      expect(sanitizeArgs("hmget", ["hash", "f1", "f2"])).to.eql([
        "hash",
        "f1",
        "f2",
      ]);
    });

    it("should show all args for EXISTS", function () {
      expect(sanitizeArgs("exists", ["k1"])).to.eql(["k1"]);
    });

    // Default: unlisted commands fully redacted
    it("should redact all args for AUTH (unlisted, falls to default)", function () {
      expect(sanitizeArgs("auth", ["password"])).to.eql(["?"]);
      expect(sanitizeArgs("AUTH", ["password"])).to.eql(["?"]);
    });

    it("should redact all args for AUTH with username", function () {
      expect(sanitizeArgs("auth", ["user", "password123"])).to.eql(["?", "?"]);
    });

    it("should redact all args for HELLO with auth", function () {
      expect(sanitizeArgs("hello", ["3", "AUTH", "user", "pass"])).to.eql([
        "?",
        "?",
        "?",
        "?",
      ]);
    });

    it("should redact all args for unknown custom commands", function () {
      expect(sanitizeArgs("mycustomcmd", ["arg1", "arg2"])).to.eql(["?", "?"]);
    });

    // Case insensitivity
    it("should be case-insensitive for command matching", function () {
      expect(sanitizeArgs("set", ["key", "value"])).to.eql(["key", "?"]);
      expect(sanitizeArgs("get", ["key"])).to.eql(["key"]);
      expect(sanitizeArgs("hSet", ["hash", "field", "value"])).to.eql([
        "hash",
        "field",
        "?",
      ]);
    });

    // Edge cases
    it("should handle empty args", function () {
      expect(sanitizeArgs("ping", [])).to.eql([]);
    });

    it("should stringify non-string args", function () {
      expect(sanitizeArgs("get", [Buffer.from("key")])).to.eql(["key"]);
    });

    it("should stringify numeric args", function () {
      expect(sanitizeArgs("del", [42])).to.eql(["42"]);
    });
  });

  describe("ioredis:batch", function () {
    it("should trace MULTI as a single batch operation", async function () {
      const batchEvents: any[] = [];
      const commandEvents: any[] = [];

      const batchSubscriber = {
        start(message: any) {
          batchEvents.push(message);
        },
        end() {},
        asyncStart() {},
        asyncEnd() {},
        error() {},
      };
      const commandSubscriber = {
        start(message: any) {
          commandEvents.push(message);
        },
        end() {},
        asyncStart() {},
        asyncEnd() {},
        error() {},
      };

      const batchChannel = dc.tracingChannel("ioredis:batch");
      const commandChannel = dc.tracingChannel("ioredis:command");
      batchChannel.subscribe(batchSubscriber);
      commandChannel.subscribe(commandSubscriber);

      try {
        const redis = new Redis({ lazyConnect: true });
        await redis.connect();
        await redis
          .multi()
          .set("multi-key-1", "val1")
          .set("multi-key-2", "val2")
          .get("multi-key-1")
          .exec();
        redis.disconnect();

        // MULTI is traced as a single batch, not per-command
        expect(batchEvents.length).to.eql(1);
        expect(batchEvents[0].batchMode).to.eql("MULTI");
        expect(batchEvents[0].batchSize).to.eql(3);
        expect(batchEvents[0].database).to.be.a("number");
        expect(batchEvents[0].serverAddress).to.be.a("string");

        // No per-command traces for MULTI on ioredis:command
        const multiCommandEvents = commandEvents.filter(
          (e: any) => e.batchMode === "MULTI"
        );
        expect(multiCommandEvents.length).to.eql(0);
      } finally {
        batchChannel.unsubscribe(batchSubscriber);
        commandChannel.unsubscribe(commandSubscriber);
      }
    });
  });

  describe("ioredis:connect", function () {
    it("should trace the connection", async function () {
      const events: { name: string; context: any }[] = [];
      const subscriber = {
        start(message: any) {
          events.push({ name: "start", context: message });
        },
        end(message: any) {
          events.push({ name: "end", context: message });
        },
        asyncStart(message: any) {
          events.push({ name: "asyncStart", context: message });
        },
        asyncEnd(message: any) {
          events.push({ name: "asyncEnd", context: message });
        },
        error(message: any) {
          events.push({ name: "error", context: message });
        },
      };

      const channel = dc.tracingChannel("ioredis:connect");
      channel.subscribe(subscriber);

      try {
        const redis = new Redis({ lazyConnect: true });
        await redis.connect();
        redis.disconnect();

        const startEvents = events.filter((e) => e.name === "start");
        expect(startEvents.length).to.eql(1);
        expect(startEvents[0].context.serverAddress).to.eql("localhost");
        expect(startEvents[0].context.serverPort).to.eql(6379);
        expect(startEvents[0].context.connectionEpoch).to.eql(0);

        const asyncEndEvents = events.filter((e) => e.name === "asyncEnd");
        expect(asyncEndEvents.length).to.eql(1);
      } finally {
        channel.unsubscribe(subscriber);
      }
    });

    it("should trace connection failure", async function () {
      const events: { name: string; context: any }[] = [];
      const subscriber = {
        start(message: any) {
          events.push({ name: "start", context: message });
        },
        end(message: any) {
          events.push({ name: "end", context: message });
        },
        asyncStart(message: any) {
          events.push({ name: "asyncStart", context: message });
        },
        asyncEnd(message: any) {
          events.push({ name: "asyncEnd", context: message });
        },
        error(message: any) {
          events.push({ name: "error", context: message });
        },
      };

      const channel = dc.tracingChannel("ioredis:connect");
      channel.subscribe(subscriber);

      try {
        const redis = new Redis({
          port: 1, // unlikely to have a Redis server on port 1
          lazyConnect: true,
          retryStrategy: () => null, // don't retry
          connectTimeout: 1000,
        });

        try {
          await redis.connect();
        } catch {
          // Expected to fail
        }

        const startEvents = events.filter((e) => e.name === "start");
        expect(startEvents.length).to.eql(1);
        expect(startEvents[0].context.serverAddress).to.eql("localhost");
        expect(startEvents[0].context.serverPort).to.eql(1);

        // Should have error event
        const errorEvents = events.filter((e) => e.name === "error");
        expect(errorEvents.length).to.be.greaterThan(0);
      } finally {
        channel.unsubscribe(subscriber);
      }
    });
  });
});
