import * as calculateSlot from "cluster-key-slot";
import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";

describe("cluster:MOVED", () => {
  it("should auto redirect the command to the correct nodes", (done) => {
    let cluster = undefined;
    let moved = false;
    let times = 0;
    const slotTable = [
      [0, 1, ["127.0.0.1", 30001]],
      [2, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (times++ === 1) {
          expect(moved).to.eql(true);
          process.nextTick(() => {
            cluster.disconnect();
            done();
          });
        }
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        expect(moved).to.eql(false);
        moved = true;
        slotTable[0][1] = 16381;
        slotTable[1][0] = 16382;
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster.get("foo", () => {
      cluster.get("foo");
    });
  });

  it("should be able to redirect a command to a unknown node", (done) => {
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
        return [
          [0, 16381, ["127.0.0.1", 30001]],
          [16382, 16383, ["127.0.0.1", 30002]],
        ];
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
    });
    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      retryDelayOnFailover: 1,
    });
    cluster.get("foo", function (err, res) {
      expect(res).to.eql("bar");
      cluster.disconnect();
      done();
    });
  });

  it("should auto redirect the command within a pipeline", (done) => {
    let cluster = undefined;
    let moved = false;
    let times = 0;
    const slotTable = [
      [0, 1, ["127.0.0.1", 30001]],
      [2, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (times++ === 1) {
          expect(moved).to.eql(true);
          process.nextTick(() => {
            cluster.disconnect();
            done();
          });
        }
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        expect(moved).to.eql(false);
        moved = true;
        slotTable[0][1] = 16381;
        slotTable[1][0] = 16382;
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      lazyConnect: false,
    });
    cluster.get("foo", () => {
      cluster.get("foo");
    });
  });

  it("refreshes the connection when MOVED points back at the same node", (done) => {
    // Simulates a proxy endpoint whose backing server changed: old
    // connections answer with MOVED pointing at the same address, new
    // ones are routed correctly. https://github.com/redis/ioredis/issues/1865
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    let swapped = false;
    let movedCount = 0;
    const freshSockets = new Set();
    const server = new MockServer(30001, (argv, c) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (swapped && !freshSockets.has(c)) {
          movedCount += 1;
          return new Error(
            "MOVED " + calculateSlot("foo") + " 127.0.0.1:30001"
          );
        }
        return "bar";
      }
    });
    server.on("connect", (c) => {
      if (swapped) {
        freshSockets.add(c);
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);
    // Establish the pooled connection before the swap so it goes stale.
    cluster.get("foo", (err, res) => {
      expect(err).to.eql(null);
      expect(res).to.eql("bar");
      swapped = true;
      cluster.get("foo", (err2, res2) => {
        expect(err2).to.eql(null);
        expect(res2).to.eql("bar");
        expect(movedCount).to.eql(1);
        cluster.disconnect();
        done();
      });
    });
  });

  it("recreates the connection only once for concurrent circular MOVED", (done) => {
    // Two in-flight commands on the same stale connection both receive
    // MOVED pointing back at the node. Only the first should replace the
    // connection; the second must reuse the fresh one.
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    let swapped = false;
    const freshSockets = new Set();
    const server = new MockServer(30001, (argv, c) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (swapped && !freshSockets.has(c)) {
          return new Error(
            "MOVED " + calculateSlot("foo") + " 127.0.0.1:30001"
          );
        }
        return "bar";
      }
    });
    server.on("connect", (c) => {
      if (swapped) {
        freshSockets.add(c);
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);
    cluster.get("foo", (err, res) => {
      expect(err).to.eql(null);
      expect(res).to.eql("bar");
      swapped = true;
      const recreateSpy = sinon.spy(cluster.connectionPool, "recreate");
      Promise.all([cluster.get("foo"), cluster.get("foo")]).then(
        ([res1, res2]) => {
          expect(res1).to.eql("bar");
          expect(res2).to.eql("bar");
          expect(recreateSpy.callCount).to.eql(1);
          cluster.disconnect();
          done();
        },
        done
      );
    });
  });

  it("should supports retryDelayOnMoved", (done) => {
    let cluster = undefined;
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30002");
      }
    });

    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        cluster.disconnect();
        done();
      }
    });

    const retryDelayOnMoved = 789;
    cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      retryDelayOnMoved,
    });
    cluster.on("ready", () => {
      sinon.stub(global, "setTimeout").callsFake((body, ms) => {
        if (ms === retryDelayOnMoved) {
          process.nextTick(() => {
            body();
          });
        }
      });

      cluster.get("foo");
    });
  });
});
