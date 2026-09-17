import { expect } from "chai";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

const PORT = 30002;

const ready = (redis: Redis) =>
  new Promise<void>((resolve) => redis.once("ready", () => resolve()));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("handoff write gate", () => {
  it("queues commands while writes are paused and replays them on resume", async () => {
    const received: string[] = [];
    new MockServer(PORT, (argv) => {
      received.push(argv[0]);
      if (argv[0] === "get") {
        return "bar";
      }
    });

    const redis = new Redis({ port: PORT });
    await ready(redis);

    const token = (redis as any).maintenanceManager.pauseWrites();
    const pending = redis.get("foo");

    await wait(50);
    expect(received).to.not.include("get");
    expect((redis as any).offlineQueue.length).to.eql(1);
    expect((redis as any).commandQueue.length).to.eql(0);

    (redis as any).maintenanceManager.resumeWrites(token);

    expect(await pending).to.eql("bar");
    expect(received).to.include("get");
    redis.disconnect();
  });

  it("refuses a second pause and ignores stale resume tokens", async () => {
    const received: string[] = [];
    new MockServer(PORT, (argv) => {
      received.push(argv[0]);
      if (argv[0] === "get") {
        return "bar";
      }
    });

    const redis = new Redis({ port: PORT });
    await ready(redis);

    const token = (redis as any).maintenanceManager.pauseWrites();
    expect(() => (redis as any).maintenanceManager.pauseWrites()).to.throw(
      "A connection handoff is already in progress"
    );

    const pending = redis.get("foo");
    (redis as any).maintenanceManager.resumeWrites(Symbol("stale"));

    await wait(50);
    expect(received).to.not.include("get");

    (redis as any).maintenanceManager.resumeWrites(token);
    expect(await pending).to.eql("bar");
    redis.disconnect();
  });

  it("keeps pipelines contiguous across a pause", async () => {
    const received: string[] = [];
    new MockServer(PORT, (argv) => {
      received.push(argv[0]);
      if (argv[0] === "set") {
        return "OK";
      }
      if (argv[0] === "get") {
        return "1";
      }
    });

    const redis = new Redis({ port: PORT });
    await ready(redis);

    const token = (redis as any).maintenanceManager.pauseWrites();
    const exec = redis.pipeline().set("a", "1").get("a").exec();

    await wait(50);
    expect(received).to.not.include("set");

    (redis as any).maintenanceManager.resumeWrites(token);
    const results = await exec;

    expect(results).to.eql([
      [null, "OK"],
      [null, "1"],
    ]);
    expect(received.filter((name) => name === "set" || name === "get")).to.eql([
      "set",
      "get",
    ]);
    redis.disconnect();
  });

  it("keeps transactions intact across a pause", async () => {
    const redis = new Redis();
    await ready(redis);

    const token = (redis as any).maintenanceManager.pauseWrites();
    const exec = redis
      .multi()
      .set("handoff-write-gate-multi", "v")
      .get("handoff-write-gate-multi")
      .exec();

    await wait(50);
    // multi + set + get + exec are all retained.
    expect((redis as any).offlineQueue.length).to.eql(4);

    (redis as any).maintenanceManager.resumeWrites(token);
    const results = await exec;

    expect(results).to.eql([
      [null, "OK"],
      [null, "v"],
    ]);
    redis.disconnect();
  });

  it("replays autopipelined commands after resume", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    await ready(redis);
    await redis.set("handoff-write-gate-auto", "42");

    const token = (redis as any).maintenanceManager.pauseWrites();
    const first = redis.get("handoff-write-gate-auto");
    const second = redis.get("handoff-write-gate-auto");

    (redis as any).maintenanceManager.resumeWrites(token);

    expect(await first).to.eql("42");
    expect(await second).to.eql("42");
    redis.disconnect();
  });

  it("replays custom script commands after resume", async () => {
    const redis = new Redis();
    await ready(redis);
    redis.defineCommand("echoFortyTwo", {
      numberOfKeys: 0,
      lua: "return 42",
    });

    const token = (redis as any).maintenanceManager.pauseWrites();
    const pending = (redis as any).echoFortyTwo();

    (redis as any).maintenanceManager.resumeWrites(token);

    expect(await pending).to.eql(42);
    redis.disconnect();
  });

  it("rejects commands during a pause when enableOfflineQueue is false", async () => {
    new MockServer(PORT, (argv) => {
      if (argv[0] === "get") {
        return "bar";
      }
    });

    const redis = new Redis({ port: PORT, enableOfflineQueue: false });
    await ready(redis);

    const token = (redis as any).maintenanceManager.pauseWrites();

    const err = await redis.get("foo").then(
      () => null,
      (e) => e
    );
    expect(err?.message).to.eql(
      "Command cannot be queued during a connection handoff because enableOfflineQueue is false"
    );

    (redis as any).maintenanceManager.resumeWrites(token);
    expect(await redis.get("foo")).to.eql("bar");
    redis.disconnect();
  });

  it("clears the pause when the connection closes", async () => {
    let socket: any;
    const received: string[] = [];
    const server = new MockServer(PORT, (argv) => {
      received.push(argv[0]);
      if (argv[0] === "get") {
        return "bar";
      }
    });
    server.on("connect", (c) => {
      socket = c;
    });

    const redis = new Redis({ port: PORT, retryStrategy: () => 10 });
    redis.on("error", () => {});
    await ready(redis);

    (redis as any).maintenanceManager.pauseWrites();
    const pending = redis.get("foo");

    socket.destroy();
    await new Promise((resolve) => redis.once("close", resolve));
    expect((redis as any).maintenanceManager.isWritePaused()).to.eql(false);

    // The ordinary reconnect flow replays the offline queue.
    expect(await pending).to.eql("bar");
    redis.disconnect();
  });

  it("signals when the command queue drains", async () => {
    let socket: any;
    const server = new MockServer(PORT, (argv, _socket, flags) => {
      if (argv[0] === "get") {
        flags.hang = true;
      }
    });
    server.on("connect", (c) => {
      socket = c;
    });

    const redis = new Redis({ port: PORT });
    await ready(redis);

    // Resolves immediately when nothing is in flight.
    await (redis as any).waitForCommandQueueToDrain();

    const pending = redis.get("foo").catch(() => {});
    let drained = false;
    const drain = (redis as any)
      .waitForCommandQueueToDrain()
      .then(() => (drained = true));

    await wait(50);
    expect(drained).to.eql(false);

    socket.write("$3\r\nbar\r\n");
    await drain;
    expect(drained).to.eql(true);
    expect(await pending).to.eql("bar");
    redis.disconnect();
  });

  it("rejects the drain waiter when the connection closes", async () => {
    let socket: any;
    const server = new MockServer(PORT, (argv, _socket, flags) => {
      if (argv[0] === "get") {
        flags.hang = true;
      }
    });
    server.on("connect", (c) => {
      socket = c;
    });

    const redis = new Redis({ port: PORT, retryStrategy: null });
    redis.on("error", () => {});
    await ready(redis);

    redis.get("foo").catch(() => {});
    const drain = (redis as any).waitForCommandQueueToDrain().then(
      () => null,
      (e: Error) => e
    );

    socket.destroy();
    const err = await drain;

    expect(err?.message).to.eql(
      "Connection closed while waiting for the command queue"
    );
    redis.disconnect();
  });
});
