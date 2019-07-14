import MockServer from "../../helpers/mock_server";
import { Cluster } from "../../../lib";
import { expect } from "chai";

describe("cluster:duplicate", () => {
  it("clone the options", done => {
    var node = new MockServer(30001);
    var cluster = new Cluster([]);
    var duplicatedCluster = cluster.duplicate([
      { host: "127.0.0.1", port: "30001" }
    ]);

    node.once("connect", function() {
      expect(duplicatedCluster.nodes()).to.have.lengthOf(1);
      expect(duplicatedCluster.nodes()[0].options.port).to.eql(30001);
      cluster.disconnect();
      duplicatedCluster.disconnect();
      done();
    });
  });
});
