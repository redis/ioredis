import { expect } from "chai";
import { EventEmitter } from "events";
import * as sinon from "sinon";
import { ReplyError } from "redis-errors";
import Command from "../../../lib/Command";
import ShardedSubscriberHealthCheck, {
  HealthCheckedConnection,
} from "../../../lib/cluster/ShardedSubscriberHealthCheck";

const INTERVAL = 1000;
const realSetImmediate = setImmediate;
const flushPromises = () => new Promise((resolve) => realSetImmediate(resolve));

class FakeConnection extends EventEmitter implements HealthCheckedConnection {
  private pending: Command[] = [];
  // Mirrors Redis.sendCommand() applying the `commandTimeout` option.
  commandTimeout: number | undefined;
  sendCommand = sinon.stub().callsFake((command: Command) => {
    expect(command.name).to.equal("ping");
    if (this.commandTimeout !== undefined) {
      command.setTimeout(this.commandTimeout);
    }
    this.pending.push(command);
    return command.promise;
  });
  disconnect = sinon.stub();

  get ping() {
    return this.sendCommand;
  }

  answer() {
    this.pending.shift()?.resolve("PONG");
  }

  fail(err: Error) {
    this.pending.shift()?.reject(err);
  }
}

describe("ShardedSubscriberHealthCheck", () => {
  let clock: sinon.SinonFakeTimers;
  let connection: FakeConnection;
  let healthCheck: ShardedSubscriberHealthCheck;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    connection = new FakeConnection();
    healthCheck = new ShardedSubscriberHealthCheck(
      connection,
      INTERVAL,
      "127.0.0.1:30000"
    );
  });

  afterEach(() => {
    sinon.restore();
    clock.restore();
  });

  const connect = () => {
    connection.emit("connect");
    connection.emit("ready");
  };

  const streamMessages = (intervals: number) => {
    for (let elapsed = 0; elapsed < intervals * INTERVAL; elapsed += 100) {
      connection.emit("smessageBuffer");
      clock.tick(100);
    }
  };

  it("does nothing before connect", () => {
    clock.tick(10 * INTERVAL);

    expect(connection.ping.called, "pinged before connect").to.equal(false);
    expect(
      connection.disconnect.called,
      "disconnected before connect"
    ).to.equal(false);
  });

  it("disconnects a connection whose handshake stays unanswered for an interval", () => {
    connection.emit("connect");

    clock.tick(INTERVAL - 1);
    expect(connection.disconnect.called, "disconnected early").to.equal(false);

    clock.tick(1);
    expect(connection.disconnect.callCount).to.equal(1);
    expect(connection.ping.called, "pinged before ready").to.equal(false);
  });

  it("restarts the countdown on ready", () => {
    connection.emit("connect");
    clock.tick(INTERVAL - 1);
    connection.emit("ready");

    clock.tick(INTERVAL - 1);
    expect(connection.disconnect.called, "disconnected after ready").to.equal(
      false
    );
    expect(
      connection.ping.called,
      "pinged before a full interval after ready"
    ).to.equal(false);

    clock.tick(1);
    expect(
      connection.ping.callCount,
      "pings a full interval after ready"
    ).to.equal(1);
  });

  it("pings once per interval and keeps the connection while pings are answered", async () => {
    connect();

    for (let fire = 1; fire <= 5; fire++) {
      clock.tick(INTERVAL);
      expect(connection.ping.callCount, `pings after fire ${fire}`).to.equal(
        fire
      );
      connection.answer();
      await flushPromises();
    }
    expect(connection.disconnect.called).to.equal(false);
  });

  it("disconnects at the next fire when a ping stays unanswered", () => {
    connect();

    clock.tick(INTERVAL);
    expect(connection.ping.callCount, "ping sent at the first fire").to.equal(
      1
    );
    expect(
      connection.disconnect.called,
      "disconnected at the first fire"
    ).to.equal(false);

    clock.tick(INTERVAL);
    expect(
      connection.disconnect.callCount,
      "disconnects at the second fire"
    ).to.equal(1);
  });

  it("disconnects a connection that keeps delivering messages but answers no ping", () => {
    connect();

    streamMessages(10);

    expect(connection.disconnect.callCount).to.equal(1);
  });

  it("disconnects only once even as time passes", () => {
    connect();

    clock.tick(10 * INTERVAL);

    expect(connection.ping.callCount).to.equal(1);
    expect(connection.disconnect.callCount).to.equal(1);
  });

  it("keeps a connection whose ping is answered just before the next fire", async () => {
    connect();

    clock.tick(INTERVAL);
    clock.tick(INTERVAL - 1);
    connection.answer();
    await flushPromises();
    clock.tick(1);

    expect(connection.disconnect.called).to.equal(false);
    expect(connection.ping.callCount).to.equal(2);
  });

  it("disconnects at the next fire when a ping is rejected by a local command timeout", async () => {
    connect();

    clock.tick(INTERVAL);
    connection.fail(new Error("Command timed out"));
    await flushPromises();
    expect(
      connection.disconnect.called,
      "disconnected before the next fire"
    ).to.equal(false);

    clock.tick(INTERVAL);
    expect(connection.disconnect.callCount).to.equal(1);
    expect(connection.ping.callCount, "pinged again").to.equal(1);
  });

  it("gives a ping the full interval when commandTimeout is shorter", async () => {
    connection.commandTimeout = INTERVAL / 10;
    connect();

    clock.tick(INTERVAL);
    clock.tick(INTERVAL - 1);
    connection.answer();
    await flushPromises();
    clock.tick(1);

    expect(connection.disconnect.called).to.equal(false);
    expect(connection.ping.callCount).to.equal(2);
  });

  it("keeps a connection whose ping gets a server error reply", async () => {
    connect();

    for (let fire = 1; fire <= 5; fire++) {
      clock.tick(INTERVAL);
      connection.fail(
        new ReplyError(
          "NOPERM this user has no permissions to run the 'ping' command"
        )
      );
      await flushPromises();
    }

    expect(connection.ping.callCount).to.equal(5);
    expect(connection.disconnect.called).to.equal(false);
  });

  it("swallows a rejected ping", async () => {
    const unhandled = sinon.spy();
    process.on("unhandledRejection", unhandled);

    try {
      connect();
      clock.tick(INTERVAL);
      connection.fail(new Error("Connection is closed."));
      await flushPromises();
    } finally {
      process.removeListener("unhandledRejection", unhandled);
    }

    expect(unhandled.called, "rejection surfaced as unhandled").to.equal(false);
  });

  it("stops on close", async () => {
    connect();
    clock.tick(INTERVAL);

    connection.emit("close");
    connection.fail(new Error("Connection is closed."));
    await flushPromises();
    clock.tick(5 * INTERVAL);

    expect(connection.ping.callCount).to.equal(1);
    expect(connection.disconnect.called).to.equal(false);
  });

  it("stops on close during the handshake", () => {
    connection.emit("connect");

    connection.emit("close");
    clock.tick(5 * INTERVAL);

    expect(connection.disconnect.called).to.equal(false);
  });

  it("cancels a pending check on stop", () => {
    connect();

    healthCheck.stop();
    clock.tick(5 * INTERVAL);

    expect(connection.ping.called).to.equal(false);
    expect(connection.disconnect.called).to.equal(false);
  });

  it("stays stopped when messages arrive after stop", () => {
    connect();
    healthCheck.stop();

    streamMessages(5);

    expect(connection.ping.called).to.equal(false);
    expect(connection.disconnect.called).to.equal(false);
  });

  it("checks again after a new connect following stop", () => {
    connect();
    healthCheck.stop();

    connect();
    clock.tick(INTERVAL);

    expect(connection.ping.callCount).to.equal(1);
  });

  it("ignores a ping from before stop that is answered after a new connect", async () => {
    connect();
    clock.tick(INTERVAL);
    healthCheck.stop();

    connect();
    clock.tick(INTERVAL);
    expect(connection.ping.callCount, "pings after the new connect").to.equal(
      2
    );

    // Answer the stale ping only. The new ping stays unanswered.
    connection.answer();
    await flushPromises();
    clock.tick(INTERVAL);

    expect(connection.disconnect.callCount).to.equal(1);
  });
});
