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
    // Use "bar" which maps to slot 5061 (in range 0-12181 with replica)
    // MOVED should only happen once, on the master node
    const getHandler = (argv) => {
      const cmd = String(argv[0]).toLowerCase();
      const key = String(argv[1] || "");
      if (cmd === "get" && key === "bar") {
        if (movedCount === 0) {
          // First GET request to master - return MOVED to trigger the fix
          movedCount++;
          return new Error("MOVED " + calculateSlot("bar") + " 127.0.0.1:30001");
        }
        // After MOVED, all GET requests should succeed
        return "value";
      }
      return undefined;
    };
    
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      return getHandler(argv);
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      // This node handles different slot range, but add handler to avoid "OK" default
      return getHandler(argv);
    });
    // Replica needs to handle GET requests since scaleReads=all can route reads here
    // Replica should not return MOVED, just serve the read
    new MockServer(30003, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      const cmd = String(argv[0]).toLowerCase();
      const key = String(argv[1] || "");
      if (cmd === "get" && key === "bar") {
        return "value";
      }
      return undefined;
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      scaleReads: "all",
      enableAutoPipelining: true,
    });

    cluster.on("ready", () => {
      const slot = calculateSlot("bar");
      
      // This should trigger autopipelining and MOVED handling
      Promise.all([
        cluster.get("bar"),
        cluster.get("bar"),
        cluster.get("bar"),
      ])
        .then((results) => {
          // All should succeed
          expect(results).to.eql(["value", "value", "value"]);

          // Verify that replica information is preserved after MOVED
          // Since MOVED points to the same master (30001), the slot array should not be overridden
          // Check slots after operations to avoid race conditions with Node version differences
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
    let movedHappened = false;
    // Use "bar" which maps to slot 5061 (in range 0-12181 with replica)
    // For pipeline retry to work with mixed readonly/write commands,
    // ALL commands in the pipeline need to get the same MOVED error initially
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      // Handle both individual commands and pipeline commands
      const cmd = String(argv[0]).toLowerCase();
      const key = String(argv[1] || "");
      
      // Return MOVED for ALL commands (GET and SET) on first attempt
      // This allows the pipeline retry logic to work properly
      if ((cmd === "get" || cmd === "set") && key === "bar") {
        if (!movedHappened) {
          movedHappened = true;
          return new Error("MOVED " + calculateSlot("bar") + " 127.0.0.1:30001");
        }
        // After MOVED, all requests should succeed
        if (cmd === "get") {
          return "value";
        }
        if (cmd === "set") {
          return "OK";
        }
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    // Replica also needs to handle commands (scaleReads=all can send reads here)
    // Replica should forward to master, not return MOVED itself
    new MockServer(30003, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      const cmd = String(argv[0]).toLowerCase();
      const key = String(argv[1] || "");
      if (cmd === "get" && key === "bar") {
        // Replica can serve reads, but if MOVED happens, it should go to master
        // Never return MOVED from replica - let master handle it
        return "value";
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      scaleReads: "all",
      enableAutoPipelining: true,
    });

    cluster.on("ready", () => {
      // Use explicit pipeline to test the fix - should not throw allocation group error
      // even when MOVED error occurs and slot info might be changed
      cluster
        .pipeline()
        .get("bar")
        .set("bar", "value")
        .get("bar")
        .exec((err, results) => {
          // Should not throw the allocation group error - this is the main test
          expect(err).to.eql(null);
          expect(results).to.be.an("array");
          expect(results.length).to.eql(3);
          
          // All commands should succeed (no errors in results)
          for (let i = 0; i < results.length; i++) {
            expect(results[i][0]).to.eql(null); // No error
          }
          
          // Verify we got the expected values (order may vary with retries)
          const values = results.map((r) => r[1]);
          const valueCount = values.filter((v) => v === "value").length;
          const okCount = values.filter((v) => v === "OK").length;
          expect(valueCount).to.eql(2); // Two GET commands
          expect(okCount).to.eql(1); // One SET command

          cluster.disconnect();
          done();
        });
    });
  });
});
