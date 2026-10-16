import { PassThrough } from "stream";
import { expect } from "chai";
import * as sinon from "sinon";
import Redis from "../../lib/Redis";
import StandaloneConnector from "../../lib/connectors/StandaloneConnector";
import MockServer from "../helpers/mock_server";

class NeverConnectingConnector extends StandaloneConnector {
  connect(): Promise<any> {
    return new Promise(() => {
      // Never resolves nor rejects, like a connection attempt that hangs.
    });
  }
}

describe("commandTimeout", () => {
  it("rejects if command timed out", (done) => {
    const server = new MockServer(30001, (argv, socket, flags) => {
      if (argv[0] === "hget") {
        flags.hang = true;
        return;
      }
    });

    const redis = new Redis({ port: 30001, commandTimeout: 1000 });
    const clock = sinon.useFakeTimers();
    redis.hget("foo", (err) => {
      expect(err.message).to.eql("Command timed out");
      clock.restore();
      redis.disconnect();
      server.disconnect(() => done());
    });
    clock.tick(1000);
  });

  it("does not leak timers for commands in offline queue", async () => {
    const server = new MockServer(30001);

    const redis = new Redis({ port: 30001, commandTimeout: 1000 });
    const clock = sinon.useFakeTimers();
    await redis.hget("foo");
    expect(clock.countTimers()).to.eql(0);
    clock.restore();
    redis.disconnect();
    await server.disconnectPromise();
  });

  it("rejects queued commands with Connection is closed when disconnected while connecting", async () => {
    const redis = new Redis({
      port: 30020,
      lazyConnect: true,
      commandTimeout: 50,
      Connector: NeverConnectingConnector,
    });
    redis.on("error", () => {});

    const rejection = await new Promise<string>((resolve) => {
      // Parks in the offline queue with an armed commandTimeout timer.
      redis.set("foo", "bar").catch((err) => resolve(err.message));
      redis.disconnect();
    });
    expect(rejection).to.eql("Connection is closed.");
    expect(redis.status).to.eql("end");

    // The orphaned timer would have fired by now, rejecting the already
    // settled command again and keeping the event loop alive.
    await new Promise((resolve) => setTimeout(resolve, 80));
    redis.disconnect();
  });

  it("rejects queued commands with Connection is closed when disconnected while reconnecting", async () => {
    const redis = new Redis({
      port: 30021,
      commandTimeout: 50,
      retryStrategy: () => 10000,
      maxRetriesPerRequest: null,
    });
    redis.on("error", () => {});
    await new Promise<void>((resolve) => redis.once("reconnecting", resolve));

    const rejection = await new Promise<string>((resolve) => {
      // Parks in the offline queue with an armed commandTimeout timer.
      redis.set("foo", "bar").catch((err) => resolve(err.message));
      redis.disconnect();
    });
    expect(rejection).to.eql("Connection is closed.");
    expect(redis.status).to.eql("end");

    // The orphaned timer would have fired by now, rejecting the already
    // settled command again and keeping the event loop alive.
    await new Promise((resolve) => setTimeout(resolve, 80));
    redis.disconnect();
  });

  it("ignores a late connect that resolves after disconnect ended the client", async () => {
    class DelayedConnector extends StandaloneConnector {
      connect() {
        return new Promise((resolve) => {
          setTimeout(() => {
            const stream = new PassThrough();
            stream.setNoDelay = () => {};
            stream.connecting = false;
            stream.destroyed = false;
            stream.destroy = () => {
              stream.destroyed = true;
              stream.emit("close");
            };
            resolve(stream);
          }, 50);
        });
      }
    }

    const redis = new Redis({
      port: 30023,
      lazyConnect: true,
      commandTimeout: 50,
      Connector: DelayedConnector,
    });
    redis.on("error", () => {});

    const setPromise = redis.set("foo", "bar").catch((err) => {
      expect(err.message).to.eql("Connection is closed.");
      return err;
    });
    redis.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(redis.status).to.eql("end");
    expect(redis.stream).to.eql(undefined);

    await setPromise;
  });

  it("emits end exactly once when disconnected while connecting to a refused port", async () => {
    const redis = new Redis({
      port: 30022,
      lazyConnect: true,
      commandTimeout: 50,
      retryStrategy: () => 10000,
      maxRetriesPerRequest: null,
      connectTimeout: 10000,
    });
    redis.on("error", () => {});

    const endCount = { count: 0 };
    redis.on("end", () => {
      endCount.count++;
    });

    // Refused connection rejects the connector promise asynchronously,
    // after the synchronous disconnect() cleanup has already ended the
    // client; the late "end" transition must not fire a second time.
    const rejection = await new Promise<string>((resolve) => {
      redis.set("foo", "bar").catch((err) => resolve(err.message));
      redis.disconnect();
    });
    expect(rejection).to.eql("Connection is closed.");
    expect(redis.status).to.eql("end");

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(endCount.count).to.eql(1);
  });

  it("does not schedule reconnect when disconnect races a stream close", async () => {
    const server = new MockServer(30001);
    const redis = new Redis({ port: 30001, commandTimeout: 5000 });
    await redis.set("foo", "bar");

    // Destroy the stream and disconnect in the same tick: the synchronous
    // cleanup ends the client, and the stream's own deferred close handler
    // must not treat that as a crash and schedule a reconnect afterwards.
    redis.stream!.destroy();
    redis.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(redis.status).to.eql("end");

    await server.disconnectPromise();
  });
});
