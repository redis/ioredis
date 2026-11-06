import { expect } from "chai";
import { EventEmitter } from "events";
import * as sinon from "sinon";
import Deque = require("denque");
import ShardedSubscriberHealthCheck, {
  HealthCheckedConnection,
} from "../../../lib/cluster/ShardedSubscriberHealthCheck";
import { CommandItem } from "../../../lib/types";

const INTERVAL = 1000;
const realSetImmediate = setImmediate;

const commandItem = (name: string) =>
  ({ command: { name } } as unknown as CommandItem);

class FakeConnection extends EventEmitter implements HealthCheckedConnection {
  commandQueue = new Deque<CommandItem>();
  status = "ready";
  ping = sinon.stub().callsFake(() => {
    this.write("ping");
    return Promise.resolve("PONG");
  });
  disconnect = sinon.stub();

  write(name: string) {
    this.commandQueue.push(commandItem(name));
  }

  answer() {
    this.commandQueue.shift();
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

  it("pings an idle connection once per interval and keeps it while pings are answered", () => {
    connect();

    for (let fire = 1; fire <= 5; fire++) {
      clock.tick(INTERVAL);
      expect(connection.ping.callCount, `pings after fire ${fire}`).to.equal(
        fire
      );
      connection.answer();
    }
    expect(connection.disconnect.called).to.equal(false);
  });

  it("sends no ping while messages keep arriving on an idle connection", () => {
    connect();

    streamMessages(10);

    expect(connection.ping.called).to.equal(false);
    expect(connection.disconnect.called).to.equal(false);
  });

  it("disconnects once when a command stays unanswered while messages keep arriving", () => {
    connect();
    connection.write("ssubscribe");

    streamMessages(10);

    expect(connection.disconnect.callCount).to.equal(1);
  });

  it("disconnects at the second fire when a ping stays unanswered", () => {
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

  it("disconnects only once even as time passes and messages keep arriving", () => {
    connect();
    clock.tick(2 * INTERVAL);

    streamMessages(10);
    clock.tick(10 * INTERVAL);

    expect(connection.disconnect.callCount).to.equal(1);
  });

  it("keeps a connection whose command written just before a fire is answered before the next", () => {
    connect();

    clock.tick(INTERVAL - 1);
    connection.write("ssubscribe");
    clock.tick(1);
    connection.answer();
    clock.tick(INTERVAL);

    expect(connection.disconnect.called).to.equal(false);
  });

  it("keeps a busy connection whose queue head changes between fires", () => {
    connect();
    connection.write("ssubscribe");

    for (let fire = 1; fire <= 5; fire++) {
      clock.tick(INTERVAL);
      connection.answer();
      connection.write("ssubscribe");
    }

    expect(connection.disconnect.called).to.equal(false);
  });

  it("does not ping an idle connection that is not ready", () => {
    connection.status = "connect";
    connection.emit("connect");

    clock.tick(5 * INTERVAL);

    expect(connection.ping.called).to.equal(false);
  });

  it("disconnects when a handshake command queued at connect stays unanswered", () => {
    connection.status = "connect";
    connection.write("client");
    connection.emit("connect");

    clock.tick(2 * INTERVAL);

    expect(connection.disconnect.callCount).to.equal(1);
  });

  it("restarts the countdown on ready", () => {
    connection.emit("connect");
    clock.tick(INTERVAL - 1);
    connection.emit("ready");

    clock.tick(INTERVAL - 1);
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

  it("cancels a pending check on stop", () => {
    connect();

    healthCheck.stop();
    clock.tick(5 * INTERVAL);

    expect(connection.ping.called).to.equal(false);
    expect(connection.disconnect.called).to.equal(false);
  });

  it("stays stopped when ready and messages arrive after stop", () => {
    connect();
    healthCheck.stop();

    connection.emit("ready");
    streamMessages(1);
    clock.tick(5 * INTERVAL);

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

  it("swallows a rejected ping", async () => {
    const unhandled = sinon.spy();
    process.on("unhandledRejection", unhandled);
    connection.ping.callsFake(() =>
      Promise.reject(new Error("Connection is closed."))
    );

    try {
      connect();
      clock.tick(INTERVAL);
      await new Promise((resolve) => realSetImmediate(resolve));
    } finally {
      process.removeListener("unhandledRejection", unhandled);
    }

    expect(connection.ping.callCount, "ping sent").to.equal(1);
    expect(unhandled.called, "rejection surfaced as unhandled").to.equal(false);
  });
});
