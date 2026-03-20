import Redis from "../../lib/Redis";
import { expect } from "chai";

// TracingChannel requires Node >= 20.13. Skip tests on older versions.
const nodeVersion = process.versions.node.split(".").map(Number);
const hasTracingChannel = nodeVersion[0] > 20 || (nodeVersion[0] === 20 && nodeVersion[1] >= 13);

const describeOrSkip = hasTracingChannel ? describe : describe.skip;

describeOrSkip("tracing", function () {
  let dc: typeof import("node:diagnostics_channel");

  before(function () {
    dc = ("getBuiltinModule" in process)
      ? (process as any).getBuiltinModule("node:diagnostics_channel")
      : require("node:diagnostics_channel");
  });

  describe("ioredis:command", function () {
    it("should trace a simple command", async function () {
      const events: { name: string; context: any }[] = [];
      const subscriber = {
        start(message: any) { events.push({ name: "start", context: message }); },
        end(message: any) { events.push({ name: "end", context: message }); },
        asyncStart(message: any) { events.push({ name: "asyncStart", context: message }); },
        asyncEnd(message: any) { events.push({ name: "asyncEnd", context: message }); },
        error(message: any) { events.push({ name: "error", context: message }); },
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

        // Check SET context fields
        const setStart = setEvents.find((e) => e.name === "start");
        expect(setStart).to.exist;
        expect(setStart.context.command).to.eql("set");
        expect(setStart.context.args).to.include("tracing-test-key");
        expect(setStart.context.args).to.include("tracing-test-value");
        expect(setStart.context.database).to.eql(0);
        expect(setStart.context.serverAddress).to.be.a("string");
        expect(setStart.context.batchMode).to.be.undefined;
        expect(setStart.context.batchSize).to.be.undefined;

        // Check GET context fields
        const getStart = getEvents.find((e) => e.name === "start");
        expect(getStart).to.exist;
        expect(getStart.context.command).to.eql("get");
        expect(getStart.context.args).to.include("tracing-test-key");

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
        start(message: any) { events.push(message); },
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
        start(message: any) { events.push(message); },
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
        start(message: any) { events.push(message); },
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

    it("should trace MULTI/EXEC commands with batchMode 'MULTI'", async function () {
      const events: any[] = [];
      const subscriber = {
        start(message: any) { events.push(message); },
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
          .multi()
          .set("multi-key-1", "val1")
          .get("multi-key-1")
          .exec();
        redis.disconnect();

        const multiEvents = events.filter((e) => e.batchMode === "MULTI");
        expect(multiEvents.length).to.be.greaterThan(0);
        for (const evt of multiEvents) {
          expect(evt.batchMode).to.eql("MULTI");
          // batchSize should count only user commands (SET + GET), not MULTI/EXEC
          expect(evt.batchSize).to.eql(2);
        }
      } finally {
        channel.unsubscribe(subscriber);
      }
    });

    it("should not cause unhandled rejections for failed pipeline commands", async function () {
      const errorEvents: any[] = [];
      const subscriber = {
        start() {},
        end() {},
        asyncStart() {},
        asyncEnd() {},
        error(message: any) { errorEvents.push(message); },
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
        start(message: any) { events.push(message); },
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
        error(message: any) { errorEvents.push(message); },
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

  describe("ioredis:connect", function () {
    it("should trace the connection", async function () {
      const events: { name: string; context: any }[] = [];
      const subscriber = {
        start(message: any) { events.push({ name: "start", context: message }); },
        end(message: any) { events.push({ name: "end", context: message }); },
        asyncStart(message: any) { events.push({ name: "asyncStart", context: message }); },
        asyncEnd(message: any) { events.push({ name: "asyncEnd", context: message }); },
        error(message: any) { events.push({ name: "error", context: message }); },
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
        start(message: any) { events.push({ name: "start", context: message }); },
        end(message: any) { events.push({ name: "end", context: message }); },
        asyncStart(message: any) { events.push({ name: "asyncStart", context: message }); },
        asyncEnd(message: any) { events.push({ name: "asyncEnd", context: message }); },
        error(message: any) { events.push({ name: "error", context: message }); },
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
