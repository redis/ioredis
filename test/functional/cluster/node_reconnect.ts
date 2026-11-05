import { expect } from "chai";
import { Socket } from "net";
import * as calculateSlot from "../../../lib/utils/calculateSlot";
import * as sinon from "sinon";
import MockServer from "../../helpers/mock_server";
import { Cluster } from "../../../lib";

describe("cluster:node_reconnect", () => {
  // "foo" hashes to slot 12182, which falls in [0, 16381] → node1 (30001)
  const slotTable = [
    [0, 16381, ["127.0.0.1", 30001], ["127.0.0.1", 30003]],
    [16382, 16383, ["127.0.0.1", 30002]],
  ];

  function argvHandler(argv: string[]) {
    if (argv[0] === "cluster" && argv[1] === "SLOTS") {
      return slotTable;
    }
  }

  it("fires -node when node disconnects and clusterNodeRetryStrategy is null", (done) => {
    const node1 = new MockServer(30001, argvHandler);
    new MockServer(30002, argvHandler);
    new MockServer(30003, argvHandler);

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      clusterNodeRetryStrategy: null,
      clusterRetryStrategy: null,
    });

    // cluster.get("foo") routes to node1 (slot 12182), ensuring it is connected
    cluster.get("foo", () => {
      cluster.once("-node", (removedNode) => {
        expect(removedNode.options.port).to.eql(30001);
        cluster.disconnect();
        done();
      });
      node1.disconnect();
    });
  });

  it("keeps node in pool when clusterNodeRetryStrategy is a function", (done) => {
    const node1 = new MockServer(30001, argvHandler);
    new MockServer(30002, argvHandler);
    new MockServer(30003, argvHandler);

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      clusterNodeRetryStrategy: () => 10,
      clusterRetryStrategy: null,
    });

    cluster.get("foo", () => {
      let nodeRemovedFired = false;
      cluster.once("-node", () => {
        nodeRemovedFired = true;
      });

      node1.disconnect(() => {
        setTimeout(() => {
          expect(nodeRemovedFired).to.be.false;
          cluster.disconnect();
          done();
        }, 100);
      });
    });
  });

  it("retries command on another node when target node is reconnecting and enableOfflineQueue is false", (done) => {
    const node1 = new MockServer(30001, argvHandler);
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") return slotTable;
      if (argv[0] === "get" && argv[1] === "foo") return "bar";
    });
    new MockServer(30003, argvHandler);

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      clusterNodeRetryStrategy: () => 10,
      enableOfflineQueue: false,
    });

    cluster.once("ready", () => {
      const node1Redis = cluster
        .nodes("master")
        .find((n) => n.options.port === 30001);

      cluster.get("foo", () => {
        node1.disconnect();

        // Wait for the node to enter "reconnecting" state, then verify
        // the command is retried on another node (not permanently rejected)
        node1Redis.once("reconnecting", () => {
          cluster.get("foo", (err, result) => {
            expect(err).to.be.null;
            expect(result).to.eql("bar");
            cluster.disconnect();
            done();
          });
        });
      });
    });
  });

  it("MOVED redirect to an unknown node succeeds with enableOfflineQueue: false", (done) => {
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30002");
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      clusterRetryStrategy: null,
      enableOfflineQueue: false,
    });

    // Wait for the cluster to be ready before sending the command,
    // since enableOfflineQueue: false rejects commands before "ready".
    cluster.once("ready", () => {
      cluster.get("foo", (err, result) => {
        expect(err).to.be.null;
        expect(result).to.eql("bar");
        cluster.disconnect();
        done();
      });
    });
  });

  it("does not reject subscriber commands when subscriber is not ready and enableOfflineQueue is false", (done: (err?: unknown) => void) => {
    new MockServer(30001, argvHandler);
    new MockServer(30002, argvHandler);
    new MockServer(30003, argvHandler);

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      clusterRetryStrategy: null,
      enableOfflineQueue: false,
    });

    cluster.once("ready", () => {
      const sendCommand = sinon.spy((command) => {
        command.resolve(Buffer.from("OK"));
      });
      sinon
        .stub(cluster["subscriber"], "getInstance")
        .returns({ status: "connecting", sendCommand } as never);

      cluster.subscribe("channel").then(() => {
        expect(sendCommand.called).to.be.true;
        sinon.restore();
        cluster.disconnect();
        done();
      }, done);
    });
  });

  it("reconnects to a node after it restarts", (done) => {
    const node1 = new MockServer(30001, argvHandler);
    new MockServer(30002, argvHandler);
    new MockServer(30003, argvHandler);

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      clusterNodeRetryStrategy: () => 10,
      clusterRetryStrategy: null,
    });

    cluster.get("foo", () => {
      node1.disconnect(() => {
        setTimeout(() => {
          node1.connect();
          node1.once("connect", () => {
            cluster.disconnect();
            done();
          });
        }, 30);
      });
    });
  });

  it("does not split an auto-pipeline batch when a node is still connecting and enableOfflineQueue is false", async () => {
    // One shard, a master and a replica. The master answers nothing on connections
    // opened after `stall` is set, so its replacement connection stays in "connect".
    const slotTable = [[0, 16383, ["127.0.0.1", 30001], ["127.0.0.1", 30002]]];
    const stalled = new Set<Socket>();
    let stall = false;
    const handler = (argv: string[], socket: Socket, flags: any) => {
      if (stalled.has(socket)) {
        flags.hang = true;
        return;
      }
      if (argv[0] === "cluster" && argv[1] === "SLOTS") return slotTable;
      if (argv[0] === "get") return "v" + argv[1];
    };
    const master = new MockServer(30001, handler);
    new MockServer(30002, handler);
    master.on("connect", (socket: Socket) => {
      if (stall) stalled.add(socket);
    });

    // The first command of the batch goes to the master, all others to the replica.
    let routed = 0;
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      enableAutoPipelining: true,
      enableOfflineQueue: false,
      clusterRetryStrategy: null,
      scaleReads: (nodes) => (routed++ === 0 ? nodes[0] : nodes[1]),
    });
    await new Promise<void>((resolve) => cluster.once("ready", resolve));
    const replica = cluster.nodes("slave")[0];
    await replica.ping();

    // Replace the master connection, as a circular MOVED does (#2135).
    stall = true;
    const connecting = cluster.connectionPool.recreate(
      { host: "127.0.0.1", port: 30001 },
      false
    );
    connecting.connect().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(connecting.status).to.equal("connect");

    const settle = (promise: Promise<unknown>) =>
      Promise.race([
        promise.then(
          (value) => "ok:" + value,
          () => "error"
        ),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 300)),
      ]);

    routed = 0;
    const batch = Array.from({ length: 20 }, (_, i) => cluster.get("key" + i));
    await settle(Promise.all(batch));

    // The unsent commands must not stay in the replica's queue: every reply on its
    // connection has to reach the command it was meant for.
    const keys = Array.from({ length: 25 }, (_, i) => "direct" + i);
    const results = await Promise.all(keys.map((k) => settle(replica.get(k))));
    expect(results).to.eql(keys.map((k) => "ok:v" + k));

    cluster.disconnect();
  });
});
