import MockServer from "../../helpers/mock_server";
import { Cluster } from "../../../lib";

describe("cluster:TRYAGAIN", () => {
  it("should retry the command", (done) => {
    let cluster;
    let times = 0;
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        if (times++ === 1) {
          process.nextTick(() => {
            cluster.disconnect();
            done();
          });
        } else {
          return new Error(
            "TRYAGAIN Multiple keys request during rehashing of slot"
          );
        }
      }
    });

    cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      retryDelayOnTryAgain: 1,
    });
    cluster.get("foo");
  });
});
