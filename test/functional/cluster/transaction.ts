import * as calculateSlot from "cluster-key-slot";
import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";

describe("cluster:transaction", () => {
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
      if (argv[1] === "foo") {
        return "QUEUED";
      }
      if (argv[0] === "exec") {
        expect(moved).to.eql(true);
        return ["bar", "OK"];
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        moved = true;
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
      if (argv[0] === "exec") {
        return new Error(
          "EXECABORT Transaction discarded because of previous errors."
        );
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);

    cluster
      .multi()
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
      if (argv[0] === "multi") {
        expect(asked).to.eql(true);
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        expect(asked).to.eql(false);
        return "bar";
      }
      if (argv[0] === "exec") {
        expect(asked).to.eql(false);
        return ["bar", "OK"];
      }
      if (argv[0] !== "asking") {
        asked = false;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return new Error("ASK " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
      if (argv[0] === "exec") {
        return new Error(
          "EXECABORT Transaction discarded because of previous errors."
        );
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .multi()
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

  it("should not print unhandled warnings", (done) => {
    const errorMessage = "Connection is closed.";
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    new MockServer(
      30001,
      function (argv) {
        if (argv[0] === "exec" || argv[1] === "foo") {
          return new Error(errorMessage);
        }
      },
      slotTable
    );

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      maxRedirections: 3,
    });

    let isDoneCalled = false;
    const wrapDone = function (error?: Error) {
      if (isDoneCalled) {
        return;
      }
      isDoneCalled = true;
      process.removeAllListeners("unhandledRejection");
      done(error);
    };

    process.on("unhandledRejection", (err) => {
      wrapDone(new Error("got unhandledRejection: " + (err as Error).message));
    });
    cluster
      .multi()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err) {
        expect(err).to.have.property("message", errorMessage);
        cluster.on("end", () => {
          // Wait for the end event to ensure the transaction
          // promise has been resolved.
          wrapDone();
        });
        cluster.disconnect();
      });
  });
});
