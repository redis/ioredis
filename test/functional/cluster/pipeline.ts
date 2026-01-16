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

  it("should not throw 'All keys in the pipeline should belong to the same slots allocation group' when replica returned MOVED error", (done) => {
    let moved = false;
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001], ["127.0.0.1", 30003]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "bar") {
        return "bar2";
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
      if (argv[0] === "get" && argv[1] === "bar") {
        if (!moved) {
          moved = true;
          return new Error("MOVED " + calculateSlot("bar") + " 127.0.0.1:30001");
        }
        return "bar2";
      }
      if (argv[0] === "get" && argv[1] === "baz") {
        return "baz2";
      }
    });
    // saleReads = "slave" so that we will 100% get read operations from replica
    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      scaleReads: "slave",
    });
    cluster.on('ready', () => {
      /** get bar first time - moved is thrown, slots map is updated */
      cluster.pipeline()
        .get('bar')
        .exec((err, res) => {
          expect(err).to.eql(null);
          expect(res).to.have.lengthOf(1);
          if (res && res.length > 0) {
            expect(res[0][0]).to.eql(null);
            expect(res[0][1]).to.eql("bar2");
          }
          /** get bar and baz, which have the same slots - validation for the pipeline command should be executed */
          cluster.pipeline().get('bar').get('baz').exec((err, res) => {
            expect(err).to.eql(null);
            expect(res).to.have.lengthOf(2);
            if (res && res.length > 0) {
              let bar2 = false;
              let baz2 = false;
              for (let i = 0; i < res.length; i++) {
                if (res[i][0] === null) {
                  if (res[i][1] === "bar2") {
                    bar2 = true;
                  }
                  if (res[i][1] === "baz2") {
                    baz2 = true;
                  }
                }
              }
              expect(bar2).to.eql(true);
              expect(baz2).to.eql(true);
            }
            cluster.disconnect();
            done();
          });  
      });
    });
  });
});
