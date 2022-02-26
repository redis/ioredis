import MockServer from "../../helpers/mock_server";
import * as calculateSlot from "cluster-key-slot";
import { expect } from "chai";
import { Cluster } from "../../../lib";

describe("cluster:ASK", () => {
  it("should support ASK", (done) => {
    let asked = false;
    let times = 0;
    const slotTable = [
      [0, 1, ["127.0.0.1", 30001]],
      [2, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        expect(asked).to.eql(true);
      } else if (argv[0] === "asking") {
        asked = true;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (++times === 2) {
          process.nextTick(() => {
            cluster.disconnect();
            done();
          });
        } else {
          return new Error("ASK " + calculateSlot("foo") + " 127.0.0.1:30001");
        }
      }
    });

    var cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      lazyConnect: false,
    });
    cluster.get("foo", () => {
      cluster.get("foo");
    });
  });

  it("should be able to redirect a command to a unknown node", (done) => {
    let asked = false;
    const slotTable = [[0, 16383, ["127.0.0.1", 30002]]];
    new MockServer(30001, (argv) => {
      if (argv[0] === "get" && argv[1] === "foo") {
        expect(asked).to.eql(true);
        return "bar";
      } else if (argv[0] === "asking") {
        asked = true;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return new Error("ASK " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30002" }]);
    cluster.get("foo", function (err, res) {
      expect(res).to.eql("bar");
      cluster.disconnect();
      done();
    });
  });
});
