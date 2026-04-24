import { expect } from "chai";
import * as calculateSlot from "cluster-key-slot";
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
});
