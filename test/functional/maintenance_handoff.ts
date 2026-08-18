import { expect } from "chai";
import * as sinon from "sinon";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

const PORT_A = 30005;
const PORT_B = 30006;
const DEAD_PORT = 30099;

const ready = (redis: Redis) =>
  new Promise<void>((resolve) => redis.once("ready", () => resolve()));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean, timeoutMs = 1000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const movingFrame = (timeSeconds: number, endpoint: string) =>
  MockServer.raw(
    `>4\r\n$6\r\nMOVING\r\n:1\r\n:${timeSeconds}\r\n$${endpoint.length}\r\n${endpoint}\r\n`
  );

/** A server whose GET replies identify it, so tests can see routing. */
const createIdentityServer = (port: number, identity: string) => {
  const sockets: any[] = [];
  const server = new MockServer(port, (argv) => {
    if (argv[0] === "get") {
      return identity;
    }
  });
  server.on("connect", (socket) => {
    sockets.push(socket);
  });
  return { server, sockets };
};

describe("maintenance handoff", () => {
  it("hands the connection off to the endpoint announced by MOVING", async () => {
    const a = createIdentityServer(PORT_A, "A");
    createIdentityServer(PORT_B, "B");

    const redis = new Redis({ port: PORT_A });
    await ready(redis);
    expect(await redis.get("who")).to.eql("A");

    const closed = sinon.spy();
    const reconnecting = sinon.spy();
    redis.on("close", closed);
    redis.on("reconnecting", reconnecting);

    a.server.broadcast(movingFrame(2, `localhost:${PORT_B}`));
    await waitFor(() => (redis as any).maintenanceManager.isWritePaused());

    // Submitted while the handoff is in flight: gated, then replayed to the
    // replacement connection.
    expect(await redis.get("who")).to.eql("B");
    expect(redis.status).to.eql("ready");
    expect((redis as any).options.port).to.eql(PORT_B);

    await wait(10);
    expect(closed.called).to.eql(false);
    expect(reconnecting.called).to.eql(false);
    redis.disconnect();
  });

  it("rolls back to the old connection when the endpoint is unreachable", async () => {
    const a = createIdentityServer(PORT_A, "A");

    const redis = new Redis({ port: PORT_A });
    await ready(redis);

    a.server.broadcast(movingFrame(1, `localhost:${DEAD_PORT}`));
    await waitFor(() => (redis as any).maintenanceManager.isWritePaused());

    // Gated during the failed handoff, then replayed to the old connection.
    expect(await redis.get("who")).to.eql("A");
    expect(redis.status).to.eql("ready");
    expect((redis as any).options.port).to.eql(PORT_A);
    redis.disconnect();
  });

  it("recovers through ordinary reconnect when the old connection dies mid-handoff", async () => {
    const a = createIdentityServer(PORT_A, "A");
    // The replacement accepts the socket but never answers the handshake,
    // so the candidate stays pending while the old connection dies.
    new MockServer(PORT_B, (_argv, _socket, flags) => {
      flags.hang = true;
    });

    const redis = new Redis({ port: PORT_A, retryStrategy: () => 10 });
    redis.on("error", () => {});
    await ready(redis);

    a.server.broadcast(movingFrame(1, `localhost:${PORT_B}`));
    await waitFor(() => (redis as any).maintenanceManager.isWritePaused());

    a.sockets[0].destroy();
    await ready(redis);

    expect(await redis.get("who")).to.eql("A");
    expect((redis as any).maintenanceManager.isWritePaused()).to.eql(false);
    expect((redis as any).options.port).to.eql(PORT_A);

    // The stale handoff hitting its grace deadline must not disturb the
    // reconnected client.
    await wait(1100);
    expect(redis.status).to.eql("ready");
    expect(await redis.get("who")).to.eql("A");
    redis.disconnect();
  });

  it("keeps the selected database across a handoff", async () => {
    const a = createIdentityServer(PORT_A, "A");
    const bReceived: string[][] = [];
    new MockServer(PORT_B, (argv) => {
      bReceived.push(argv);
      if (argv[0] === "get") {
        return "B";
      }
    });

    const redis = new Redis({ port: PORT_A });
    await ready(redis);
    await redis.select(2);

    a.server.broadcast(movingFrame(2, `localhost:${PORT_B}`));
    await waitFor(() => (redis as any).maintenanceManager.isWritePaused());

    expect(await redis.get("who")).to.eql("B");
    expect(
      bReceived.some(([command, arg]) => command === "select" && arg === "2")
    ).to.eql(true);
    expect((redis as any).condition.select).to.eql(2);
    redis.disconnect();
  });

  it("rolls back when the candidate dies while the old queue drains", async () => {
    const aSockets: any[] = [];
    const serverA = new MockServer(PORT_A, (argv, _socket, flags) => {
      if (argv[0] === "get" && argv[1] === "blocked") {
        flags.hang = true;
        return;
      }
      if (argv[0] === "get") {
        return "A";
      }
    });
    serverA.on("connect", (socket) => aSockets.push(socket));
    const b = createIdentityServer(PORT_B, "B");

    const redis = new Redis({ port: PORT_A });
    redis.on("error", () => {});
    await ready(redis);

    // Occupies the command queue so the drain cannot complete yet.
    const blocked = redis.get("blocked");
    await wait(10);

    serverA.broadcast(movingFrame(2, `localhost:${PORT_B}`));
    await waitFor(() => (redis as any).maintenanceManager.isWritePaused());
    await waitFor(() => b.sockets.length === 1);

    // The candidate dies while the old connection is still draining. Its
    // owning temporary client absorbs the failure; nothing may crash.
    b.sockets[0].destroy();

    // Unblock the drain; the handoff must fail at detach and roll back.
    aSockets[0].write("$1\r\nA\r\n");
    expect(await blocked).to.eql("A");

    expect(await redis.get("who")).to.eql("A");
    expect((redis as any).maintenanceManager.isWritePaused()).to.eql(false);
    expect((redis as any).options.port).to.eql(PORT_A);
    expect(redis.status).to.eql("ready");
    redis.disconnect();
  });

  it("does not hand off a subscriber connection", async () => {
    const a = createIdentityServer(PORT_A, "A");
    const b = createIdentityServer(PORT_B, "B");

    const redis = new Redis({ port: PORT_A });
    await ready(redis);
    await redis.subscribe("channel");

    a.server.broadcast(movingFrame(1, `localhost:${PORT_B}`));
    await wait(50);

    expect(b.sockets.length).to.eql(0);
    expect((redis as any).maintenanceManager.isMaintenanceActive()).to.eql(
      true
    );
    redis.disconnect();
  });
});
