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
});
