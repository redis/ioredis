import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";

describe("cluster:CLUSTERDOWN", function () {
  it("should redirect the command to a random node", function (done) {
    const slotTable = [
      [0, 1, ["127.0.0.1", 30001]],
      [2, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, function (argv) {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
    });
    new MockServer(30002, function (argv) {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return new Error("CLUSTERDOWN");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      lazyConnect: false,
      retryDelayOnClusterDown: 1,
    });
    cluster.get("foo", function (_, res) {
      expect(res).to.eql("bar");
      cluster.disconnect();
      done();
    });
  });
});
