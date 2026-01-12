import * as calculateSlot from "cluster-key-slot";
import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";

describe("cluster:pipeline", () => {
  it("should throw when not all keys in a pipeline command belong to the same slot", (done) => {
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .pipeline()
      .set("foo", "bar")
      .mget("foo1", "foo2")
      .exec()
      .catch(function (err) {
        expect(err.message).to.match(
          /All the keys in a pipeline command should belong to the same slot/
        );
        cluster.disconnect();
        done();
      });
  });

  it("should throw when not all keys in different pipeline commands belong to the same allocation group", (done) => {
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .pipeline()
      .set("foo1", "bar")
      .get("foo2")
      .exec()
      .catch(function (err) {
        expect(err.message).to.match(
          /All keys in the pipeline should belong to the same slots allocation group/
        );
        cluster.disconnect();
        done();
      });
  });

  it("should auto redirect commands on MOVED", (done) => {
    let moved = false;
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[1] === "foo") {
        if (argv[0] === "set") {
          expect(moved).to.eql(false);
          moved = true;
        }
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .pipeline()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0]).to.eql([null, "bar"]);
        expect(result[1]).to.eql([null, "OK"]);
        cluster.disconnect();
        done();
      });
  });

  it("should auto redirect commands on ASK", (done) => {
    let asked = false;
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "asking") {
        asked = true;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        expect(asked).to.eql(true);
        return "bar";
      }
      if (argv[0] !== "asking") {
        asked = false;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[1] === "foo") {
        return new Error("ASK " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .pipeline()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0]).to.eql([null, "bar"]);
        expect(result[1]).to.eql([null, "OK"]);
        cluster.disconnect();
        done();
      });
  });

  it("should retry the command on TRYAGAIN", (done) => {
    let times = 0;
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[1] === "foo") {
        if (times++ < 2) {
          return new Error(
            "TRYAGAIN Multiple keys request during rehashing of slot"
          );
        }
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      retryDelayOnTryAgain: 1,
    });
    cluster
      .pipeline()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err, result) {
        expect(result[0][1]).to.eql("OK");
        expect(result[1][1]).to.eql("OK");
        cluster.disconnect();
        done();
      });
  });

  it("should not redirect commands on a non-readonly command is successful", (done) => {
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .pipeline()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0][0].message).to.match(/MOVED/);
        expect(result[1]).to.eql([null, "OK"]);
        cluster.disconnect();
        done();
      });
  });

  it("should retry when redis is down", (done) => {
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    const node2 = new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      retryDelayOnFailover: 1,
    });
    const stub = sinon
      .stub(cluster, "refreshSlotsCache")
      .callsFake((...args) => {
        node2.connect();
        stub.restore();
        cluster.refreshSlotsCache(...args);
      });
    node2.disconnect();
    cluster
      .pipeline()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0]).to.eql([null, "bar"]);
        expect(result[1]).to.eql([null, "OK"]);
        cluster.disconnect();
        done();
      });
  });

  it("should preserve replica information when MOVED error occurs with scaleReads=all and autopipelining", (done) => {
    const slotTable = [
      [
        0,
        12181,
        ["127.0.0.1", 30001],
        ["127.0.0.1", 30003], // replica
      ],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    let movedCount = 0;
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (movedCount === 0) {
          // First request - return MOVED to trigger the fix
          movedCount++;
          return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
        }
        return "bar";
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    new MockServer(30003, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      scaleReads: "all",
      enableAutoPipelining: true,
    });

    cluster.on("ready", () => {
      // Verify initial slot setup includes replica
      const slot = calculateSlot("foo");
      expect(cluster.slots[slot]).to.include("127.0.0.1:30003");

      // This should trigger autopipelining and MOVED handling
      Promise.all([
        cluster.get("foo"),
        cluster.get("foo"),
        cluster.get("foo"),
      ])
        .then((results) => {
          // All should succeed
          expect(results).to.eql(["bar", "bar", "bar"]);

          // Verify that replica information is preserved after MOVED
          // Since MOVED points to the same master (30001), the slot array should not be overridden
          expect(cluster.slots[slot]).to.include("127.0.0.1:30003");
          expect(cluster.slots[slot][0]).to.eql("127.0.0.1:30001"); // Master should be at position 0

          cluster.disconnect();
          done();
        })
        .catch((err) => {
          cluster.disconnect();
          done(err);
        });
    });
  });

  it("should not throw 'All keys in the pipeline should belong to the same slots allocation group' with scaleReads=all and autopipelining", (done) => {
    const slotTable = [
      [
        0,
        12181,
        ["127.0.0.1", 30001],
        ["127.0.0.1", 30003], // replica
      ],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    let movedCount = 0;
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (movedCount === 0) {
          movedCount++;
          return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
        }
        return "bar";
      }
      if (argv[0] === "set" && argv[1] === "foo") {
        return "OK";
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    new MockServer(30003, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      scaleReads: "all",
      enableAutoPipelining: true,
    });

    cluster.on("ready", () => {
      // Mix reads and writes to trigger the specific issue scenario
      cluster
        .pipeline()
        .get("foo")
        .set("foo", "bar")
        .get("foo")
        .exec((err, results) => {
          // Should not throw the allocation group error
          expect(err).to.eql(null);
          if (results) {
            expect(results[0][1]).to.eql("bar");
            expect(results[1][1]).to.eql("OK");
            expect(results[2][1]).to.eql("bar");
          }

          cluster.disconnect();
          done();
        });
    });
  });
});
