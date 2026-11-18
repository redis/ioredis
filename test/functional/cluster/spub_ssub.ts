import MockServer, {
  getConnectionName,
  MockServerHandler,
  pushFrame,
  pubSubReply,
} from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";
import Redis from "../../../lib/Redis";
import ShardedSubscriber from "../../../lib/cluster/ShardedSubscriber";
import ClusterSubscriberGroup from "../../../lib/cluster/ClusterSubscriberGroup";
import { noop } from "../../../lib/utils";
import { EventEmitter } from "events";
import { Socket } from "net";

describe("cluster:spub/ssub", function () {
  it("keeps sharded subscribers lazy by default", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 1, ["127.0.0.1", 30001]],
          [2, 16383, ["127.0.0.1", 30002]],
        ];
      }
    };
    const node1 = new MockServer(30001, handler);
    const node2 = new MockServer(30002, handler);

    const ssub = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      shardedSubscribers: true,
    });

    ssub.once("ready", () => {
      expect(node1.findClientByName("ioredis-cluster(ssubscriber)")).to.equal(
        undefined
      );
      expect(node2.findClientByName("ioredis-cluster(ssubscriber)")).to.equal(
        undefined
      );
      ssub.disconnect();
      done();
    });
  });

  it("respects redisOptions.lazyConnect for sharded subscribers", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 1, ["127.0.0.1", 30001]],
          [2, 16383, ["127.0.0.1", 30002]],
        ];
      }
    };
    const node1 = new MockServer(30001, handler);
    const node2 = new MockServer(30002, handler);

    const ssub = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      shardedSubscribers: true,
      redisOptions: { lazyConnect: false },
    });

    ssub.once("ready", () => {
      setTimeout(() => {
        expect(node1.findClientByName("ioredis-cluster(ssubscriber)")).to.exist;
        expect(node2.findClientByName("ioredis-cluster(ssubscriber)")).to.exist;
        ssub.disconnect();
        done();
      }, 1_000);
    });
  });

  ([2, 3] as const).forEach((protocol) => {
    it(`should receive messages - RESP ${protocol}`, (done) => {
      const handler = function (argv) {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [
            [0, 1, ["127.0.0.1", 30001]],
            [2, 16383, ["127.0.0.1", 30002]],
          ];
        }
        if (argv[0] === "ssubscribe") {
          return pubSubReply(protocol, "ssubscribe", argv[1]);
        }
      };
      new MockServer(30001, handler);
      //Node 2 is responsible for the vast majority of slots
      const node2 = new MockServer(30002, handler);
      const startupNodes = [{ host: "127.0.0.1", port: 30001 }];
      const clusterOptions = {
        shardedSubscribers: true,
        redisOptions: { protocol },
      };
      const ssub = new Cluster(startupNodes, clusterOptions);

      ssub.ssubscribe("test cluster", function () {
        const clientSocket = node2.findClientByName(
          "ioredis-cluster(ssubscriber)"
        );
        node2.write(
          clientSocket,
          pubSubReply(protocol, "smessage", "test shard channel", "hi")
        );
      });
      ssub.on("smessage", function (channel, message) {
        expect(channel).to.eql("test shard channel");
        expect(message).to.eql("hi");
        ssub.disconnect();
        done();
      });
    });
  });

  it("sunsubscribe() without channels unsubscribes across all shards", (done) => {
    const slots = [
      [0, 8191, ["127.0.0.1", 30001]],
      [8192, 16383, ["127.0.0.1", 30002]],
    ];
    const node1Commands: string[][] = [];
    const node2Commands: string[][] = [];

    const makeHandler = (sink: string[][]) =>
      function (argv) {
        sink.push(argv);
        const name = argv[0].toLowerCase();
        if (name === "cluster" && String(argv[1]).toLowerCase() === "slots") {
          return slots;
        }
        if (name === "ssubscribe") {
          return ["ssubscribe", argv[1], 1];
        }
        if (name === "sunsubscribe") {
          return ["sunsubscribe", argv[1] ?? null, 0];
        }
      };

    new MockServer(30001, makeHandler(node1Commands));
    new MockServer(30002, makeHandler(node2Commands));

    const ssub = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      shardedSubscribers: true,
    });

    const sunsubscribeOf = (commands: string[][]) =>
      commands.filter((argv) => argv[0].toLowerCase() === "sunsubscribe");

    ssub.on("ready", async () => {
      try {
        // "bar" hashes to slot 5061 (node1), "foo" to slot 12182 (node2),
        // so each shard ends up with its own sharded subscriber connection.
        await ssub.ssubscribe("bar");
        await ssub.ssubscribe("foo");

        const result = await ssub.sunsubscribe();
        expect(result).to.eql(0);

        // Every shard that held a subscription receives a zero-argument
        // SUNSUBSCRIBE, unsubscribing it from all of its shard channels.
        expect(sunsubscribeOf(node1Commands)).to.eql([["sunsubscribe"]]);
        expect(sunsubscribeOf(node2Commands)).to.eql([["sunsubscribe"]]);

        ssub.disconnect();
        done();
      } catch (err) {
        ssub.disconnect();
        done(err);
      }
    });
  });

  it("sunsubscribeAll unsubscribes shards whose connection is not ready", async () => {
    // Regression: a non-ready shard connection used to be skipped, yet its
    // channels were cleared and the call resolved with 0. On reconnect,
    // `autoResubscribe` replays SSUBSCRIBE from that connection's own
    // subscription set, so it would silently resume delivering shard messages
    // while the client believed it had unsubscribed. SUNSUBSCRIBE must reach
    // the non-ready connection too so it gets cleared once it comes back.
    const group: any = new ClusterSubscriberGroup(
      new EventEmitter(),
      {} as any
    );

    const makeSubscriber = (nodeKey: string, status: string) => {
      const redis = {
        status,
        sunsubscribe: sinon.stub().resolves(["sunsubscribe", null, 0]),
      };
      return {
        redis,
        getInstance: () => redis,
        getNodeKey: () => nodeKey,
      };
    };

    const readySub = makeSubscriber("127.0.0.1:30001", "ready");
    const connectingSub = makeSubscriber("127.0.0.1:30002", "connecting");

    group.shardedSubscribers.set("127.0.0.1:30001", readySub);
    group.shardedSubscribers.set("127.0.0.1:30002", connectingSub);
    // Map each node to a slot that currently holds a channel so
    // hasSubscribedChannels() reports both as active.
    group.subscriberToSlotsIndex.set("127.0.0.1:30001", [1]);
    group.subscriberToSlotsIndex.set("127.0.0.1:30002", [2]);
    group.channels.set(1, ["chan-ready"]);
    group.channels.set(2, ["chan-connecting"]);

    const result = await group.sunsubscribeAll();

    expect(result).to.equal(0);
    // Both the ready and the not-yet-ready connection receive SUNSUBSCRIBE.
    expect(readySub.redis.sunsubscribe.calledOnce).to.equal(true);
    expect(connectingSub.redis.sunsubscribe.calledOnce).to.equal(true);
    // Tracked channels are cleared afterwards.
    expect(group.channels.size).to.equal(0);
  });

  it("sunsubscribeAll rejects naming the failed shard and keeps its channels", async () => {
    // When a shard's SUNSUBSCRIBE fails the client may still be subscribed
    // there, so reject with the failing node and leave the tracked channels in
    // place: a zero-argument SUNSUBSCRIBE is idempotent, so a retry can safely
    // fan out again and still see those shards via hasSubscribedChannels().
    const group: any = new ClusterSubscriberGroup(
      new EventEmitter(),
      {} as any
    );

    const makeSubscriber = (nodeKey: string, sunsubscribe: any) => {
      const redis = { status: "ready", sunsubscribe };
      return {
        redis,
        getInstance: () => redis,
        getNodeKey: () => nodeKey,
      };
    };

    const okSub = makeSubscriber(
      "127.0.0.1:30001",
      sinon.stub().resolves(["sunsubscribe", null, 0])
    );
    const failSub = makeSubscriber(
      "127.0.0.1:30002",
      sinon.stub().rejects(new Error("connection lost"))
    );

    group.shardedSubscribers.set("127.0.0.1:30001", okSub);
    group.shardedSubscribers.set("127.0.0.1:30002", failSub);
    group.subscriberToSlotsIndex.set("127.0.0.1:30001", [1]);
    group.subscriberToSlotsIndex.set("127.0.0.1:30002", [2]);
    group.channels.set(1, ["chan-ok"]);
    group.channels.set(2, ["chan-fail"]);

    let error: Error | undefined;
    try {
      await group.sunsubscribeAll();
    } catch (err) {
      error = err;
    }

    expect(error).to.be.an("error");
    expect(error.message).to.contain("127.0.0.1:30002");
    // Channels stay tracked so a retry still targets both shards.
    expect(group.channels.size).to.equal(2);
  });

  it("does not apply the classic subscriber role to sharded subscribers", async () => {
    const group: any = new ClusterSubscriberGroup(new EventEmitter(), {
      subscriberNodeRole: "slave",
    });
    const master = new Redis({
      host: "127.0.0.1",
      port: 30001,
      lazyConnect: true,
    });

    await group.reset([["127.0.0.1:30001"]], [master]);

    expect(Array.from(group.shardedSubscribers.keys())).to.eql([
      "127.0.0.1:30001",
    ]);

    group.stop();
    master.disconnect();
  });

  ([2, 3] as const).forEach((protocol) => {
    it(`should works when sending regular commands - RESP ${protocol}`, (done) => {
      const handler = function (argv) {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [[0, 16383, ["127.0.0.1", 30001]]];
        }
        if (argv[0] === "ssubscribe") {
          return pubSubReply(protocol, "ssubscribe", argv[1]);
        }
      };
      new MockServer(30001, handler);

      const ssub = new Cluster([{ port: "30001" }], {
        shardedSubscribers: true,
        redisOptions: { protocol },
      });

      ssub.ssubscribe("test cluster", function () {
        ssub.set("foo", "bar").then((res) => {
          expect(res).to.eql("OK");
          ssub.disconnect();
          done();
        });
      });
    });
  });

  ([2, 3] as const).forEach((protocol) => {
    it(`supports password - RESP ${protocol}`, (done) => {
      const handler = function (argv, c) {
        if (argv[0] === "auth") {
          c.password = argv[1];
          return;
        }
        if (argv[0] === "hello") {
          c.password = argv[4];
          return;
        }
        if (argv[0] === "ssubscribe") {
          expect(c.password).to.eql("abc");
          expect(getConnectionName(c)).to.eql("ioredis-cluster(ssubscriber)");
          return pubSubReply(protocol, "ssubscribe", argv[1]);
        }
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [[0, 16383, ["127.0.0.1", 30001]]];
        }
      };
      new MockServer(30001, handler);

      const ssub = new Redis.Cluster([{ port: 30001, password: "abc" }], {
        shardedSubscribers: true,
        redisOptions: { protocol },
      });

      ssub.ssubscribe("test cluster", function () {
        ssub.disconnect();
        done();
      });
    });
  });

  // This test covers the error handler used only for sharded-subscriber-triggered
  // slots cache refreshes. Normal (non-subscriber) connections are created with
  // lazyConnect: true and can become zombied. For sharded subscribers, a
  // ClusterAllFailedError means we have lost all nodes from the subscriber
  // perspective and must tear down.
  it("should trigger reconnect when subscriber node goes down and refresh fails", (done) => {
    let clusterSlotsCallCount = 0;
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        clusterSlotsCallCount++;
        // First call: during connect() - must succeed to reach "ready" state
        // Second call: subscriber-triggered refresh after we kill the subscriber - fail to trigger reconnect
        if (clusterSlotsCallCount === 2) {
          return new Error("CLUSTERDOWN The cluster is down");
        }
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
      if (argv[0] === "ssubscribe") {
        return pubSubReply(3, "ssubscribe", argv[1]);
      }
    };
    const server = new MockServer(30001, handler);

    const ssub = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      shardedSubscribers: true,
      slotsRefreshInterval: 0, // Disable periodic refresh - test subscriber-triggered path only
    });

    ssub.once("ready", () => {
      // Make sure at least one subscriber connection is established
      ssub.ssubscribe("test").then(() => {
        // Close ONLY the subscriber connections, not the main connection.
        // The main connection stays open ("zombied") so that the reconnect is
        // driven solely by the sharded-subscriber error path, not by pool drain.
        server
          .getAllClients()
          .filter((client) => getConnectionName(client)?.includes("ssub"))
          .forEach((client) => client.destroy());
      });
    });

    // After the subscriber-triggered slots refresh fails, we expect the
    // Cluster instance to transition into the reconnecting state.
    ssub.on("reconnecting", () => {
      ssub.disconnect();
      done();
    });
  });

  it("logs a sharded subscriber connect error instead of throwing when nothing listens for errors", async () => {
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 8191, ["127.0.0.1", 30001]],
          [8192, 16383, ["127.0.0.1", 30002]],
        ];
      }
    });
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      shardedSubscribers: true,
      enableReadyCheck: false,
    });

    try {
      await new Promise((resolve) => cluster.once("ready", resolve));
      const logged = new Promise<any[]>((resolve) => {
        sinon.stub(console, "error").callsFake((...args) => resolve(args));
      });

      // "foo" hashes to slot 12182, owned by 30002, where nothing listens.
      cluster.ssubscribe("foo").catch(noop);

      const [message, stack] = await logged;
      expect(message).to.equal("[ioredis] Unhandled error event:");
      expect(stack).to.contain("Connection is closed.");
    } finally {
      cluster.disconnect();
    }
  });

  it("waits for the same in-flight sharded subscriber start", async () => {
    let resolveConnect: (() => void) | undefined;
    const connectStub = sinon.stub(Redis.prototype, "connect").callsFake(() => {
      return new Promise<void>((resolve) => {
        resolveConnect = resolve;
      });
    });

    const subscriber = new ShardedSubscriber(new EventEmitter(), {
      host: "127.0.0.1",
      port: 30001,
    });

    try {
      let firstSettled = false;
      let secondSettled = false;

      const firstStart = subscriber.start().then(() => {
        firstSettled = true;
      });
      const secondStart = subscriber.start().then(() => {
        secondSettled = true;
      });

      await Promise.resolve();

      expect(connectStub.calledOnce).to.equal(true);
      expect(subscriber.subscriberStatus).to.equal("starting");
      expect(firstSettled).to.equal(false);
      expect(secondSettled).to.equal(false);
      expect(resolveConnect).to.be.a("function");

      resolveConnect();
      await Promise.all([firstStart, secondStart]);

      expect(subscriber.subscriberStatus).to.equal("connected");
      expect(firstSettled).to.equal(true);
      expect(secondSettled).to.equal(true);
    } finally {
      subscriber.stop();
      connectStub.restore();
    }
  });

  it("does not revive after stop when an in-flight start resolves later", async () => {
    let resolveConnect: (() => void) | undefined;
    const connectStub = sinon.stub(Redis.prototype, "connect").callsFake(() => {
      return new Promise<void>((resolve) => {
        resolveConnect = resolve;
      });
    });

    const emitter = new EventEmitter();
    const forwardedMessages: string[] = [];
    const subscriber = new ShardedSubscriber(emitter, {
      host: "127.0.0.1",
      port: 30001,
    });

    emitter.on("smessage", (_, message) => {
      forwardedMessages.push(message);
    });

    const zombieInstance = subscriber.getInstance();
    expect(zombieInstance).to.exist;

    try {
      const startPromise = subscriber.start();

      await Promise.resolve();

      expect(connectStub.calledOnce).to.equal(true);
      expect(resolveConnect).to.be.a("function");

      subscriber.stop();

      expect(subscriber.getInstance()).to.equal(null);
      expect(subscriber.isStarted()).to.equal(false);
      expect(subscriber.isHealthy()).to.equal(false);

      resolveConnect();
      await startPromise;

      expect(subscriber.getInstance()).to.equal(null);
      expect(subscriber.isStarted()).to.equal(false);
      expect(subscriber.isHealthy()).to.equal(false);

      zombieInstance.emit("smessage", "channel", "late-message");
      expect(forwardedMessages).to.eql([]);
    } finally {
      connectStub.restore();
    }
  });

  // This is no longer true, since we do NOT reconnect but recreate the subscriber
  it.skip("should re-ssubscribe after reconnection", (done) => {
    new MockServer(30001, function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      } else if (argv[0] === "ssubscribe" || argv[0] === "psubscribe") {
        return [argv[0], argv[1]];
      }
    });
    const client = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      shardedSubscribers: true,
    });
    client.ssubscribe("test cluster", function () {
      const stub = sinon
        .stub(Redis.prototype, "ssubscribe")
        .callsFake((channels) => {
          expect(channels).to.eql(["test cluster"]);
          stub.restore();
          client.disconnect();
          done();
          return Redis.prototype.ssubscribe.apply(this, arguments);
        });
      client.once("end", function () {
        client.connect().catch(noop);
      });
      client.disconnect();
    });
  });
});

describe("cluster: sharded unsubscribe channel identity", () => {
  for (const protocol of [2, 3] as const) {
    for (const [name, channel, removed] of [
      ["distinct buffers", Buffer.from("news{tag}"), Buffer.from("news{tag}")],
      ["string and buffer", "news{tag}", Buffer.from("news{tag}")],
      ["buffer and string", Buffer.from("news{tag}"), "news{tag}"],
    ] as const) {
      it(`does not restore an unsubscribed channel after moving slots (${name}, RESP${protocol})`, async () => {
        let ownerPort = 30001;
        const restored: string[] = [];
        const subscriptions = new WeakMap<Socket, Set<string>>();
        let controlRestored: () => void;
        const replayed = new Promise<void>((resolve) => {
          controlRestored = resolve;
        });
        const handler: MockServerHandler = (argv, socket, flags) => {
          if (argv[0] === "cluster" && argv[1] === "SLOTS") {
            return [[0, 16383, ["127.0.0.1", ownerPort]]];
          }
          if (argv[0] === "ssubscribe" || argv[0] === "sunsubscribe") {
            if (socket.localPort === 30002 && argv[0] === "ssubscribe") {
              restored.push(...argv.slice(1));
              if (argv.includes("control{tag}")) controlRestored();
            }
            const channels = subscriptions.get(socket) ?? new Set<string>();
            subscriptions.set(socket, channels);
            for (const channel of argv.slice(1)) {
              if (argv[0] === "ssubscribe") channels.add(channel);
              else channels.delete(channel);
              target.write(
                socket,
                protocol === 3
                  ? pushFrame(argv[0], channel, channels.size)
                  : [argv[0], channel, channels.size]
              );
            }
            flags.hang = true;
          }
        };
        new MockServer(30001, handler);
        const target = new MockServer(30002, handler);
        const cluster = new Cluster([{ port: 30001 }], {
          shardedSubscribers: true,
          redisOptions: { protocol },
        });

        try {
          expect(await cluster.ssubscribe(channel)).to.equal(1);
          expect(await cluster.ssubscribe("control{tag}")).to.equal(2);
          expect(await cluster.sunsubscribe(removed)).to.equal(1);

          ownerPort = 30002;
          await new Promise<void>((resolve, reject) => {
            cluster.refreshSlotsCache((err) => (err ? reject(err) : resolve()));
          });
          await replayed;
          expect(restored).to.eql(["control{tag}"]);
        } finally {
          cluster.disconnect();
        }
      });
    }
  }
});

const isSubscriberSocket = (socket: Socket) =>
  getConnectionName(socket)?.includes("ssubscriber") ?? false;

const waitFor = async (condition: () => boolean, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("cluster: sharded resubscribe retry", () => {
  it("resubscribes after a MOVED reply from a node that still owns the slot", async () => {
    const ssubscribedOn: Socket[] = [];
    const server = new MockServer(30001, (argv, socket) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
      if (argv[0] === "ssubscribe") {
        ssubscribedOn.push(socket);
        // The first resubscribe lands while the slot looks like it is
        // migrating, but CLUSTER SLOTS still lists this node as the owner.
        if (ssubscribedOn.length === 2) {
          return new Error("MOVED 12182 127.0.0.1:30001");
        }
        return pubSubReply(3, "ssubscribe", argv[1]);
      }
    });
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      shardedSubscribers: true,
      slotsRefreshInterval: 0,
    });

    try {
      await cluster.ssubscribe("foo");
      server
        .getAllClients()
        .filter(isSubscriberSocket)
        .forEach((socket) => socket.destroy());

      await waitFor(() => ssubscribedOn.length === 3);
      expect(ssubscribedOn[2], "retried on the replacement").to.equal(
        ssubscribedOn[1]
      );

      const received = new Promise<string[]>((resolve) => {
        cluster.once("smessage", (channel, message) =>
          resolve([channel, message])
        );
      });
      server.write(
        ssubscribedOn[2],
        pubSubReply(3, "smessage", "foo", "after retry")
      );
      expect(await received).to.eql(["foo", "after retry"]);
    } finally {
      cluster.disconnect();
    }
  });

  it("does not flood CLUSTER SLOTS while the resubscribe keeps failing", async () => {
    let ssubscribeCount = 0;
    let clusterSlotsCount = 0;
    const server = new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        clusterSlotsCount += 1;
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
      if (argv[0] === "ssubscribe") {
        ssubscribeCount += 1;
        if (ssubscribeCount > 1) {
          return new Error("MOVED 12182 127.0.0.1:30001");
        }
        return pubSubReply(3, "ssubscribe", argv[1]);
      }
    });
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      shardedSubscribers: true,
      slotsRefreshInterval: 0,
    });

    try {
      await cluster.ssubscribe("foo");
      const clusterSlotsBefore = clusterSlotsCount;
      server
        .getAllClients()
        .filter(isSubscriberSocket)
        .forEach((socket) => socket.destroy());

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Retries back off at about 200, 400 and 800 ms. Each one sends a
      // resubscribe and costs two refreshes: one for the retry, one for the
      // MOVED reply.
      expect(ssubscribeCount - 1, "resubscribes").to.be.within(3, 5);
      expect(
        clusterSlotsCount - clusterSlotsBefore,
        "CLUSTER SLOTS refreshes"
      ).to.be.at.most(12);
    } finally {
      cluster.disconnect();
    }
  });
});

describe("cluster: sharded subscriber health check", () => {
  // The smallest interval the health check accepts.
  const INTERVAL = 1000;
  // Long enough for the first PING, which waits up to 200ms past an interval.
  const FIRST_PING_WAIT = 1.5 * INTERVAL;

  // Counts PINGs on subscriber connections. While `hangPing` is set, the
  // node keeps the socket open but leaves PING unanswered.
  const createServer = () => {
    const state = {
      hangPing: false,
      hangHandshake: false,
      pings: 0,
      ssubscribedOn: [] as Socket[],
    };
    const server = new MockServer(30001, (argv, socket, flags) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
      if (
        state.hangHandshake &&
        argv[0] === "client" &&
        String(argv[1]).toLowerCase() === "setname" &&
        String(argv[2]).includes("ssubscriber")
      ) {
        flags.hang = true;
        return;
      }
      if (argv[0] === "ssubscribe") {
        state.ssubscribedOn.push(socket);
        return pubSubReply(3, "ssubscribe", argv[1]);
      }
      if (argv[0].toLowerCase() === "ping" && isSubscriberSocket(socket)) {
        state.pings += 1;
        if (state.hangPing) {
          flags.hang = true;
        }
        return "PONG";
      }
    });
    return { server, state };
  };

  const createCluster = (
    shardedSubscriberHealthCheckInterval: number | null = INTERVAL
  ) =>
    new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      shardedSubscribers: true,
      shardedSubscriberHealthCheckInterval,
      slotsRefreshInterval: 0,
    });

  it("defaults the interval to 10 seconds", () => {
    const cluster = new Cluster([], { lazyConnect: true });
    expect(cluster.options.shardedSubscriberHealthCheckInterval).to.equal(
      10000
    );
  });

  it("replaces a subscriber whose node stops answering PING", async () => {
    const { server, state } = createServer();
    const cluster = createCluster();

    try {
      await cluster.ssubscribe("foo");
      await waitFor(() => state.pings >= 1);

      const removed = new Promise((resolve) => {
        cluster.once("-node", (_redis, nodeKey) => resolve(nodeKey));
      });
      state.hangPing = true;
      expect(await removed).to.equal("127.0.0.1:30001");
      state.hangPing = false;

      await waitFor(() => state.ssubscribedOn.length === 2);
      const [original, replacement] = state.ssubscribedOn;
      expect(replacement, "resubscribed on a new connection").to.not.equal(
        original
      );
      expect(original.destroyed, "old connection closed").to.equal(true);

      const received = new Promise<string[]>((resolve) => {
        cluster.once("smessage", (channel, message) =>
          resolve([channel, message])
        );
      });
      server.write(
        replacement,
        pubSubReply(3, "smessage", "foo", "after replace")
      );
      expect(await received).to.eql(["foo", "after replace"]);
    } finally {
      cluster.disconnect();
    }
  });

  it("keeps a subscriber whose node answers PING", async () => {
    const { server, state } = createServer();
    const cluster = createCluster();
    const removed = sinon.spy();
    cluster.on("-node", removed);

    try {
      await cluster.ssubscribe("foo");
      await new Promise((resolve) => setTimeout(resolve, 5 * INTERVAL));

      // PINGs at about 1, 2, 3 and 4 intervals, each up to 200ms late.
      expect(state.pings, "pings sent").to.be.at.least(3);
      expect(removed.called, "subscriber replaced").to.equal(false);
      expect(
        server.getAllClients().filter(isSubscriberSocket),
        "subscriber connections"
      ).to.have.length(1);
    } finally {
      cluster.disconnect();
    }
  });

  it("does not ping when the interval is null", async () => {
    const { state } = createServer();
    state.hangPing = true;
    const cluster = createCluster(null);
    const removed = sinon.spy();
    cluster.on("-node", removed);

    try {
      await cluster.ssubscribe("foo");
      await new Promise((resolve) => setTimeout(resolve, FIRST_PING_WAIT));

      expect(state.pings, "pings sent").to.equal(0);
      expect(removed.called, "subscriber replaced").to.equal(false);
    } finally {
      cluster.disconnect();
    }
  });

  it("disconnects a subscriber whose handshake stays unanswered", async () => {
    const { server, state } = createServer();
    state.hangHandshake = true;
    const cluster = createCluster();
    const errors: Error[] = [];
    cluster.on("error", (err) => errors.push(err));

    try {
      await new Promise((resolve) => cluster.once("ready", resolve));
      const startedAt = Date.now();
      cluster.ssubscribe("foo").catch(noop);

      await waitFor(() => errors.length > 0);
      expect(Date.now() - startedAt, "time to detect").to.be.within(
        INTERVAL - 50,
        2 * INTERVAL
      );
      expect(errors[0].message).to.equal("Connection is closed.");
      expect(state.pings, "pings before ready").to.equal(0);

      // The failed start is retried with backoff once the handshake works.
      state.hangHandshake = false;
      await waitFor(() => state.ssubscribedOn.length > 0);
      expect(
        server.getAllClients().filter(isSubscriberSocket),
        "subscriber connections"
      ).to.have.length(1);
    } finally {
      cluster.disconnect();
    }
  });

  it("stops the health check when the subscriber stops", () => {
    const clock = sinon.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });
    const subscriber = new ShardedSubscriber(
      new EventEmitter(),
      { host: "127.0.0.1", port: 30001 },
      undefined,
      INTERVAL
    );
    const instance = subscriber.getInstance()!;
    const sendCommand = sinon.spy(instance, "sendCommand");

    try {
      instance.emit("connect");
      instance.emit("ready");
      subscriber.stop();
      clock.tick(5 * INTERVAL);

      expect(clock.countTimers(), "pending timers").to.equal(0);
      expect(sendCommand.called, "pinged after stop").to.equal(false);
    } finally {
      clock.restore();
    }
  });

  it("stops pinging after the cluster disconnects", async () => {
    const { state } = createServer();
    const cluster = createCluster();

    await cluster.ssubscribe("foo");
    await waitFor(() => state.pings >= 1);
    cluster.disconnect();
    const pingsAtDisconnect = state.pings;

    // The next PING would have come one interval after the last.
    await new Promise((resolve) => setTimeout(resolve, FIRST_PING_WAIT));
    expect(state.pings).to.equal(pingsAtDisconnect);
  });
});
