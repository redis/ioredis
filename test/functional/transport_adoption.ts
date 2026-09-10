import { expect } from "chai";
import * as sinon from "sinon";
import Redis from "../../lib/Redis";
import { WatchError } from "../../lib/errors";
import type MaintenanceManager from "../../lib/maintNotifications/MaintenanceManager";
import MockServer from "../helpers/mock_server";

const PORT_A = 30003;
const PORT_B = 30004;

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

describe("transport adoption", () => {
  it("routes commands to the adopted transport without a reconnect cycle", async () => {
    createIdentityServer(PORT_A, "A");
    createIdentityServer(PORT_B, "B");

    const redis = new Redis({ port: PORT_A });
    await ready(redis);
    expect(await redis.get("who")).to.eql("A");

    const closed = sinon.spy();
    const reconnecting = sinon.spy();
    redis.on("close", closed);
    redis.on("reconnecting", reconnecting);

    const candidate = await (redis as any).createCandidateConnection({
      host: "localhost",
      port: PORT_B,
    });
    const transport = candidate.detachTransport();
    (redis as any).adoptTransport(transport, {
      host: "localhost",
      port: PORT_B,
    });

    expect(await redis.get("who")).to.eql("B");
    expect(redis.status).to.eql("ready");

    await wait(10);
    expect(closed.called).to.eql(false);
    expect(reconnecting.called).to.eql(false);
    redis.disconnect();
  });

  it("reconnects to the replacement endpoint after adoption", async () => {
    const a = createIdentityServer(PORT_A, "A");
    createIdentityServer(PORT_B, "B");

    const redis = new Redis({ port: PORT_A, retryStrategy: () => 10 });
    redis.on("error", () => {});
    await ready(redis);

    const candidate = await (redis as any).createCandidateConnection({
      host: "localhost",
      port: PORT_B,
    });
    const transport = candidate.detachTransport();
    (redis as any).adoptTransport(transport, {
      host: "localhost",
      port: PORT_B,
    });
    expect(await redis.get("who")).to.eql("B");

    const connectionsToA = a.sockets.length;

    // The release gate: losing the adopted connection must reconnect the
    // original client to the replacement endpoint, not the old one.
    transport.stream.destroy();
    await ready(redis);

    expect(await redis.get("who")).to.eql("B");
    expect(a.sockets.length).to.eql(connectionsToA);
    redis.disconnect();
  });

  it("leaves only the adopting client's listeners on the stream", async () => {
    createIdentityServer(PORT_A, "A");
    createIdentityServer(PORT_B, "B");

    const redis = new Redis({ port: PORT_A });
    await ready(redis);

    const candidate = await (redis as any).createCandidateConnection({
      host: "localhost",
      port: PORT_B,
    });
    const transport = candidate.detachTransport();

    // The candidate stripped everything it registered.
    expect(transport.stream.listenerCount("data")).to.eql(0);
    expect(transport.stream.listenerCount("error")).to.eql(0);
    expect(transport.stream.listenerCount("close")).to.eql(0);

    (redis as any).adoptTransport(transport, {
      host: "localhost",
      port: PORT_B,
    });

    expect(transport.stream.listenerCount("data")).to.eql(1);
    expect(transport.stream.listenerCount("error")).to.eql(1);
    expect(transport.stream.listenerCount("close")).to.eql(1);
    redis.disconnect();
  });

  it("delivers maintenance pushes from the adopted connection to the manager", async () => {
    createIdentityServer(PORT_A, "A");
    const b = createIdentityServer(PORT_B, "B");

    const redis = new Redis({ port: PORT_A });
    await ready(redis);
    const manager = (redis as any).maintenanceManager as MaintenanceManager;

    const candidate = await (redis as any).createCandidateConnection({
      host: "localhost",
      port: PORT_B,
    });
    const transport = candidate.detachTransport();
    (redis as any).adoptTransport(transport, {
      host: "localhost",
      port: PORT_B,
    });
    await redis.get("who");

    b.server.broadcast(
      MockServer.raw(">3\r\n$9\r\nMIGRATING\r\n:1\r\n:10\r\n")
    );
    await waitFor(() => manager.isMaintenanceActive());

    redis.disconnect();
  });

  it("leaves the original connection intact when the candidate cannot connect", async () => {
    createIdentityServer(PORT_A, "A");

    const redis = new Redis({ port: PORT_A });
    await ready(redis);

    const err = await (redis as any)
      .createCandidateConnection({ host: "localhost", port: PORT_B })
      .then(
        () => null,
        (e: Error) => e
      );

    expect(err).to.be.instanceOf(Error);
    expect(await redis.get("who")).to.eql("A");
    expect(redis.status).to.eql("ready");
    redis.disconnect();
  });

  it("refuses to adopt while commands are awaiting replies", async () => {
    const sockets: any[] = [];
    const server = new MockServer(PORT_A, (argv, _socket, flags) => {
      if (argv[0] === "get") {
        flags.hang = true;
      }
    });
    server.on("connect", (socket) => sockets.push(socket));
    createIdentityServer(PORT_B, "B");

    const redis = new Redis({ port: PORT_A });
    await ready(redis);

    const candidate = await (redis as any).createCandidateConnection({
      host: "localhost",
      port: PORT_B,
    });
    const transport = candidate.detachTransport();

    const pending = redis.get("who").catch(() => {});
    expect(() =>
      (redis as any).adoptTransport(transport, {
        host: "localhost",
        port: PORT_B,
      })
    ).to.throw("Cannot adopt a transport while commands are awaiting replies");

    // Unblock the in-flight command, then adoption succeeds.
    sockets[0].write("$1\r\nA\r\n");
    await pending;
    (redis as any).adoptTransport(transport, {
      host: "localhost",
      port: PORT_B,
    });
    expect(await redis.get("who")).to.eql("B");
    redis.disconnect();
  });

  describe("watch invalidation", () => {
    /** A server that records every command it receives. */
    const createRecordingServer = (port: number, identity: string) => {
      const commands: string[][] = [];
      const sockets: any[] = [];
      const server = new MockServer(port, (argv) => {
        commands.push(argv);
        if (argv[0] === "get") {
          return identity;
        }
        if (argv[0] === "exec") {
          return ["OK"];
        }
      });
      server.on("connect", (socket) => sockets.push(socket));
      const received = (name: string) =>
        commands.some((argv) => argv[0] === name);
      return { server, commands, sockets, received };
    };

    const adopt = async (redis: Redis, port: number) => {
      const candidate = await (redis as any).createCandidateConnection({
        host: "localhost",
        port,
      });
      const transport = candidate.detachTransport();
      (redis as any).adoptTransport(transport, { host: "localhost", port });
    };

    it("rejects MULTI/EXEC with WatchError when adoption invalidated a WATCH", async () => {
      createRecordingServer(PORT_A, "A");
      const b = createRecordingServer(PORT_B, "B");

      const redis = new Redis({ port: PORT_A });
      await ready(redis);
      await redis.watch("key");
      await adopt(redis, PORT_B);

      const err = await redis
        .multi()
        .set("key", "value")
        .exec()
        .then(
          () => null,
          (e: Error) => e
        );

      expect(err).to.be.instanceOf(WatchError);
      // Nothing of the transaction reached the replacement server.
      expect(b.received("multi")).to.eql(false);
      expect(b.received("set")).to.eql(false);
      expect(b.received("exec")).to.eql(false);
      // The scrub reset the watch state on the replacement connection.
      await waitFor(() => b.received("unwatch"));
      redis.disconnect();
    });

    it("lets a retried transaction with a fresh WATCH proceed", async () => {
      createRecordingServer(PORT_A, "A");
      const b = createRecordingServer(PORT_B, "B");

      const redis = new Redis({ port: PORT_A });
      await ready(redis);
      await redis.watch("key");
      await adopt(redis, PORT_B);

      await redis
        .multi()
        .set("key", "value")
        .exec()
        .catch(() => {});

      // The rejection cleared the invalidated watch; the retry runs on the
      // adopted connection.
      await redis.watch("key");
      const result = await redis.multi().set("key", "value").exec();
      expect(result).to.eql([[null, "OK"]]);
      expect(b.received("exec")).to.eql(true);
      redis.disconnect();
    });

    it("still rejects when WATCH is repeated after the adoption", async () => {
      createRecordingServer(PORT_A, "A");
      createRecordingServer(PORT_B, "B");

      const redis = new Redis({ port: PORT_A });
      await ready(redis);
      await redis.watch("key1");
      await adopt(redis, PORT_B);

      // The new WATCH cannot restore key1's lost watch.
      await redis.watch("key2");
      const err = await redis
        .multi()
        .set("key1", "value")
        .exec()
        .then(
          () => null,
          (e: Error) => e
        );
      expect(err).to.be.instanceOf(WatchError);
      redis.disconnect();
    });

    it("clears the invalidated watch on UNWATCH", async () => {
      createRecordingServer(PORT_A, "A");
      const b = createRecordingServer(PORT_B, "B");

      const redis = new Redis({ port: PORT_A });
      await ready(redis);
      await redis.watch("key");
      await adopt(redis, PORT_B);

      await redis.unwatch();
      await redis.watch("key");
      const result = await redis.multi().set("key", "value").exec();
      expect(result).to.eql([[null, "OK"]]);
      expect(b.received("exec")).to.eql(true);
      redis.disconnect();
    });

    it("rejects a bare MULTI after adoption invalidated a WATCH", async () => {
      createRecordingServer(PORT_A, "A");
      const b = createRecordingServer(PORT_B, "B");

      const redis = new Redis({ port: PORT_A });
      await ready(redis);
      await redis.watch("key");
      await adopt(redis, PORT_B);

      const err = await redis.multi({ pipeline: false }).then(
        () => null,
        (e: Error) => e
      );
      expect(err).to.be.instanceOf(WatchError);
      expect(b.received("multi")).to.eql(false);
      redis.disconnect();
    });

    it("does not affect a transaction completed before the adoption", async () => {
      createRecordingServer(PORT_A, "A");
      const b = createRecordingServer(PORT_B, "B");

      const redis = new Redis({ port: PORT_A });
      await ready(redis);
      await redis.watch("key");
      await redis.multi().set("key", "value").exec();
      await adopt(redis, PORT_B);

      // EXEC consumed the watch on the old connection; nothing is stale.
      const result = await redis.multi().set("key", "value").exec();
      expect(result).to.eql([[null, "OK"]]);
      expect(b.received("exec")).to.eql(true);
      redis.disconnect();
    });

    it("tracks a trailing WATCH issued after an inline transaction in a pipeline", async () => {
      createRecordingServer(PORT_A, "A");
      createRecordingServer(PORT_B, "B");

      const redis = new Redis({ port: PORT_A });
      await ready(redis);

      // The inline EXEC closes the transaction, so the trailing WATCH is a
      // plain WATCH the server establishes for the next transaction.
      await (redis as any)
        .pipeline()
        .multi()
        .set("other", "value")
        .exec()
        .watch("key")
        .get("key")
        .exec();

      await adopt(redis, PORT_B);

      const err = await redis
        .multi()
        .set("key", "value")
        .exec()
        .then(
          () => null,
          (e: Error) => e
        );
      expect(err).to.be.instanceOf(WatchError);
      redis.disconnect();
    });

    it("treats a WATCH consumed by an inline EXEC in a pipeline as cleared", async () => {
      createRecordingServer(PORT_A, "A");
      const b = createRecordingServer(PORT_B, "B");

      const redis = new Redis({ port: PORT_A });
      await ready(redis);

      // The WATCH precedes MULTI, so the inline EXEC consumes it; nothing
      // is watched once the batch completes.
      await (redis as any)
        .pipeline()
        .watch("key")
        .multi()
        .set("key", "value")
        .exec()
        .exec();

      await adopt(redis, PORT_B);

      const result = await redis.multi().set("key", "value").exec();
      expect(result).to.eql([[null, "OK"]]);
      expect(b.received("exec")).to.eql(true);
      redis.disconnect();
    });

    it("invalidates a WATCH when the connection drops during maintenance", async () => {
      const a = createRecordingServer(PORT_A, "A");

      const redis = new Redis({ port: PORT_A, retryStrategy: () => 10 });
      redis.on("error", () => {});
      await ready(redis);
      const manager = (redis as any).maintenanceManager as MaintenanceManager;

      await redis.watch("key");
      // The server announces a migration, then drops the connection — the
      // real-world order observed during a shard migration.
      a.server.broadcast(
        MockServer.raw(">3\r\n$9\r\nMIGRATING\r\n:1\r\n:10\r\n")
      );
      await waitFor(() => manager.isMaintenanceActive());
      a.sockets[a.sockets.length - 1].destroy();
      await ready(redis);

      const err = await redis
        .multi()
        .set("key", "value")
        .exec()
        .then(
          () => null,
          (e: Error) => e
        );
      expect(err).to.be.instanceOf(WatchError);

      // The rejection reset the watch state; the retry pattern works.
      await redis.watch("key");
      const result = await redis.multi().set("key", "value").exec();
      expect(result).to.eql([[null, "OK"]]);
      redis.disconnect();
    });

    it("leaves a WATCH alone when the connection drops outside maintenance", async () => {
      const a = createRecordingServer(PORT_A, "A");

      const redis = new Redis({ port: PORT_A, retryStrategy: () => 10 });
      redis.on("error", () => {});
      await ready(redis);

      await redis.watch("key");
      // No maintenance window is open: the reconnect keeps today's behavior
      // (deferred scope) and the transaction is not intercepted.
      a.sockets[a.sockets.length - 1].destroy();
      await ready(redis);

      const result = await redis.multi().set("key", "value").exec();
      expect(result).to.eql([[null, "OK"]]);
      redis.disconnect();
    });

    it("keeps a WATCH queued during the handoff pause valid", async () => {
      createRecordingServer(PORT_A, "A");
      const b = createRecordingServer(PORT_B, "B");

      const redis = new Redis({ port: PORT_A });
      await ready(redis);
      const manager = (redis as any).maintenanceManager as MaintenanceManager;

      // The WATCH is submitted while writes are paused for the handoff, so
      // it is only ever written to the replacement connection.
      const token = manager.pauseWrites();
      const watchPromise = redis.watch("key");
      await adopt(redis, PORT_B);
      manager.resumeWrites(token);
      await watchPromise;

      const result = await redis.multi().set("key", "value").exec();
      expect(result).to.eql([[null, "OK"]]);
      expect(b.received("watch")).to.eql(true);
      expect(b.received("exec")).to.eql(true);
      redis.disconnect();
    });
  });

  it("hands off to the configured endpoint at half grace on an endpointless MOVING", async () => {
    const a = createIdentityServer(PORT_A, "A");

    const redis = new Redis({ port: PORT_A });
    await ready(redis);
    expect(a.sockets.length).to.eql(1);

    const closed = sinon.spy();
    const reconnecting = sinon.spy();
    redis.on("close", closed);
    redis.on("reconnecting", reconnecting);

    // MOVING with a 2s grace and no endpoint: the client must move to the
    // configured endpoint on its own at ~1s instead of waiting for the
    // server to hard-close the old connection at 2s.
    const initialStream = (redis as any).stream;
    a.server.broadcast(MockServer.raw(">3\r\n$6\r\nMOVING\r\n:1\r\n:2\r\n"));

    await waitFor(() => a.sockets.length === 2, 1_800);
    // The candidate handshakes and is adopted; traffic flows on the new
    // socket with no close or reconnect cycle.
    await waitFor(() => (redis as any).stream !== initialStream, 1_800);
    expect(await redis.get("who")).to.eql("A");
    expect(redis.status).to.eql("ready");
    expect(closed.called).to.eql(false);
    expect(reconnecting.called).to.eql(false);
    redis.disconnect();
  });

  it("re-prepares HIMPORT fieldsets on the adopted connection", async () => {
    const aReceived: string[][] = [];
    new MockServer(PORT_A, (argv) => {
      aReceived.push(argv);
    });
    const bReceived: string[][] = [];
    new MockServer(PORT_B, (argv) => {
      bReceived.push(argv);
    });

    const redis = new Redis({
      port: PORT_A,
      himportFieldsets: [{ name: "fieldset", fields: ["a", "b"] }],
    });
    await ready(redis);
    await redis.himport("SET", "key:1", "fieldset", "1", "2");

    const candidate = await (redis as any).createCandidateConnection({
      host: "localhost",
      port: PORT_B,
    });
    const transport = candidate.detachTransport();
    (redis as any).adoptTransport(transport, {
      host: "localhost",
      port: PORT_B,
    });

    // The candidate is created without fieldsets, so nothing has been
    // prepared on the replacement connection yet.
    const himportOn = (received: string[][]) =>
      received.filter((argv) => argv[0] === "himport");
    expect(himportOn(bReceived)).to.have.lengthOf(0);

    // A managed pipeline re-prepares the fieldset before sending the SET.
    await redis
      .pipeline()
      .himport("SET", "key:2", "fieldset", "3", "4")
      .exec();

    const bHimport = himportOn(bReceived);
    expect(bHimport).to.have.lengthOf(2);
    expect(bHimport[0].slice(0, 3)).to.eql(["himport", "PREPARE", "fieldset"]);
    expect(bHimport[1].slice(0, 2)).to.eql(["himport", "SET"]);
    redis.disconnect();
  });

  it("refuses candidates for non-standalone configurations", async () => {
    const redis = new Redis({
      sentinels: [{ host: "localhost", port: 26379 }],
      name: "master",
      lazyConnect: true,
    });

    const err = await (redis as any)
      .createCandidateConnection({ host: "localhost", port: PORT_B })
      .then(
        () => null,
        (e: Error) => e
      );

    expect(err?.message).to.eql(
      "Connection handoff is only supported for standalone TCP connections"
    );
    redis.disconnect();
  });
});
