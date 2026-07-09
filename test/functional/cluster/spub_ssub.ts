import MockServer, { getConnectionName } from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";
import Redis from "../../../lib/Redis";
import ShardedSubscriber from "../../../lib/cluster/ShardedSubscriber";
import ClusterSubscriberGroup from "../../../lib/cluster/ClusterSubscriberGroup";
import { noop } from "../../../lib/utils";
import { EventEmitter } from "events";

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
        undefined,
      );
      expect(node2.findClientByName("ioredis-cluster(ssubscriber)")).to.equal(
        undefined,
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

  it("should receive messages", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 1, ["127.0.0.1", 30001]],
          [2, 16383, ["127.0.0.1", 30002]],
        ];
      }
    };
    new MockServer(30001, handler);
    //Node 2 is responsible for the vast majority of slots
    const node2 = new MockServer(30002, handler);
    const startupNodes = [{ host: "127.0.0.1", port: 30001 }];
    const clusterOptions = { shardedSubscribers: true };
    const ssub = new Cluster(startupNodes, clusterOptions);

    ssub.ssubscribe("test cluster", function () {
      const clientSocket = node2.findClientByName(
        "ioredis-cluster(ssubscriber)",
      );
      node2.write(clientSocket, ["smessage", "test shard channel", "hi"]);
    });
    ssub.on("smessage", function (channel, message) {
      expect(channel).to.eql("test shard channel");
      expect(message).to.eql("hi");
      ssub.disconnect();
      done();
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
      {} as any,
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

  it("should works when sending regular commands", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const ssub = new Cluster([{ port: "30001" }], { shardedSubscribers: true });

    ssub.ssubscribe("test cluster", function () {
      ssub.set("foo", "bar").then((res) => {
        expect(res).to.eql("OK");
        ssub.disconnect();
        done();
      });
    });
  });

  it("supports password", (done) => {
    const handler = function (argv, c) {
      if (argv[0] === "auth") {
        c.password = argv[1];
        return;
      }
      if (argv[0] === "ssubscribe") {
        expect(c.password).to.eql("abc");
        expect(getConnectionName(c)).to.eql("ioredis-cluster(ssubscriber)");
      }
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const ssub = new Redis.Cluster([{ port: 30001, password: "abc" }], {
      shardedSubscribers: true,
    });

    ssub.ssubscribe("test cluster", function () {
      ssub.disconnect();
      done();
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
      expect(subscriber.subscriberStatus).to.equal('starting');
      expect(firstSettled).to.equal(false);
      expect(secondSettled).to.equal(false);
      expect(resolveConnect).to.be.a("function");

      resolveConnect();
      await Promise.all([firstStart, secondStart]);

      expect(subscriber.subscriberStatus).to.equal('connected');
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
