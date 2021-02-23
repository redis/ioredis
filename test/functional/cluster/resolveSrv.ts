import MockServer from "../../helpers/mock_server";
import { Cluster } from "../../../lib";
import { expect } from "chai";

describe("cluster:resolveSrv", () => {
  it("support customize resolveSrv function", (done) => {
    let resolveSrvCalledCount = 0;
    new MockServer(30001, (argv, c) => {}, [
      [0, 1000, ["127.0.0.1", 30001]],
    ]);

    const cluster = new Cluster([{ host: "a.com" }], {
      useSRVRecords: true,
      resolveSrv(hostname, callback) {
        resolveSrvCalledCount++;
        if (hostname === "a.com") {
          callback(null, [{
            priority: 1,
            weight: 1,
            port: 30001,
            name: '127.0.0.1'
          }]);
        } else {
          callback(new Error("Unknown hostname"));
        }
      },
    });
    cluster.on("ready", () => {
      const nodes = cluster.nodes("master");
      expect(nodes.length).to.eql(1);
      expect(nodes[0].options.host).to.eql("127.0.0.1");
      expect(resolveSrvCalledCount).to.eql(1);
      cluster.disconnect();
      done();
    });
  });
});
