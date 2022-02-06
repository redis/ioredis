import MockServer from "../../helpers/mock_server";
import { Cluster } from "../../../lib";
import { expect } from "chai";

describe("cluster:dnsLookup", () => {
  it("resolve hostnames to IPs", (done) => {
    const slotTable = [
      [0, 1000, ["127.0.0.1", 30001]],
      [1001, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, () => {}, slotTable);
    new MockServer(30002, () => {}, slotTable);

    const cluster = new Cluster([{ host: "localhost", port: "30001" }]);
    cluster.on("ready", () => {
      const nodes = cluster.nodes("master");
      expect(nodes.length).to.eql(2);
      expect(nodes[0].options.host).to.eql("127.0.0.1");
      expect(nodes[1].options.host).to.eql("127.0.0.1");
      cluster.disconnect();
      done();
    });
  });

  it("support customize dnsLookup function", (done) => {
    let dnsLookupCalledCount = 0;
    const slotTable = [
      [0, 1000, ["127.0.0.1", 30001]],
      [1001, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv, c) => {}, slotTable);
    new MockServer(30002, (argv, c) => {}, slotTable);

    const cluster = new Cluster([{ host: "a.com", port: "30001" }], {
      dnsLookup(hostname, callback) {
        dnsLookupCalledCount += 1;
        if (hostname === "a.com") {
          callback(null, "127.0.0.1");
        } else {
          callback(new Error("Unknown hostname"));
        }
      },
    });
    cluster.on("ready", () => {
      const nodes = cluster.nodes("master");
      expect(nodes.length).to.eql(2);
      expect(nodes[0].options.host).to.eql("127.0.0.1");
      expect(nodes[1].options.host).to.eql("127.0.0.1");
      expect(dnsLookupCalledCount).to.eql(1);
      cluster.disconnect();
      done();
    });
  });

  it("reconnects when dns lookup fails", (done) => {
    const slotTable = [
      [0, 1000, ["127.0.0.1", 30001]],
      [1001, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv, c) => {}, slotTable);
    new MockServer(30002, (argv, c) => {}, slotTable);

    let retried = false;
    const cluster = new Cluster([{ host: "localhost", port: "30001" }], {
      dnsLookup(_, callback) {
        if (retried) {
          callback(null, "127.0.0.1");
        } else {
          callback(new Error("Random Exception"));
        }
      },
      clusterRetryStrategy: function (_, reason) {
        expect(reason.message).to.eql("Random Exception");
        expect(retried).to.eql(false);
        retried = true;
        return 0;
      },
    });
    cluster.on("ready", () => {
      cluster.disconnect();
      done();
    });
  });

  it("reconnects when dns lookup thrown an error", (done) => {
    const slotTable = [
      [0, 1000, ["127.0.0.1", 30001]],
      [1001, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv, c) => {}, slotTable);
    new MockServer(30002, (argv, c) => {}, slotTable);

    let retried = false;
    const cluster = new Cluster([{ host: "localhost", port: "30001" }], {
      dnsLookup(_, callback) {
        if (retried) {
          callback(null, "127.0.0.1");
        } else {
          throw new Error("Random Exception");
        }
      },
      clusterRetryStrategy: function (_, reason) {
        expect(reason.message).to.eql("Random Exception");
        expect(retried).to.eql(false);
        retried = true;
        return 0;
      },
    });
    cluster.on("ready", () => {
      cluster.disconnect();
      done();
    });
  });
});
