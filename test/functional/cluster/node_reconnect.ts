import { expect } from "chai";
import MockServer from "../../helpers/mock_server";
import { Cluster } from "../../../lib";

describe("cluster:node_reconnect", () => {
  // "foo" hashes to slot 9201, which falls in [0, 16381] → node1 (30001)
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

    // cluster.get("foo") routes to node1 (slot 9201), ensuring it is connected
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

  it("rejects commands immediately when node is reconnecting and enableOfflineQueue is false", (done) => {
    const node1 = new MockServer(30001, argvHandler);
    new MockServer(30002, argvHandler);
    new MockServer(30003, argvHandler);

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      clusterNodeRetryStrategy: () => 10,
      clusterRetryStrategy: null,
      enableOfflineQueue: false,
    });

    cluster.get("foo", () => {
      node1.disconnect(() => {
        // Node is now reconnecting; next command should be rejected immediately
        cluster.get("foo", (err) => {
          expect(err).to.exist;
          expect(err.message).to.match(/enableOfflineQueue options is false/);
          cluster.disconnect();
          done();
        });
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
