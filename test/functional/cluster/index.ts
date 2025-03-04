import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster, default as Redis } from "../../../lib";
import * as utils from "../../../lib/utils";
import * as sinon from "sinon";

describe("cluster", () => {
  it("should return the error successfully", (done) => {
    let called = false;
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
      if (argv.toString() === "get,foo,bar") {
        called = true;
        return new Error("Wrong arguments count");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster.get("foo", "bar", function (err) {
      expect(called).to.eql(true);
      expect(err.message).to.match(/Wrong arguments count/);
      cluster.disconnect();
      done();
    });
  });

  it("should get value successfully", (done) => {
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 1, ["127.0.0.1", 30001]],
          [2, 16383, ["127.0.0.1", 30002]],
        ];
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster.get("foo", function (err, result) {
      expect(result).to.eql("bar");
      cluster.disconnect();
      done();
    });
  });

  describe("enableReadyCheck", () => {
    it("should reconnect when cluster state is not ok", (done) => {
      let state = "fail";
      new MockServer(30001, (argv) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [[0, 16383, ["127.0.0.1", 30001]]];
        } else if (argv[0] === "cluster" && argv[1] === "INFO") {
          return "cluster_state:" + state;
        }
      });
      let count = 0;
      const client = new Cluster(
        [
          {
            host: "127.0.0.1",
            port: "30001",
          },
        ],
        {
          clusterRetryStrategy: function (times) {
            expect(++count).to.eql(times);
            if (count === 3) {
              state = "ok";
            }
            return 0;
          },
        }
      );
      client.on("ready", () => {
        client.disconnect();
        done();
      });
    });
  });

  describe("startupNodes", () => {
    it("should allow updating startupNodes", (done) => {
      new MockServer(30001, (argv) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [[0, 16383, ["127.0.0.1", 30001]]];
        }
        if (argv[0] === "cluster" && argv[1] === "INFO") {
          return "cluster_state:fail";
        }
      });
      const client = new Cluster(
        [
          {
            host: "127.0.0.1",
            port: "30001",
          },
        ],
        {
          clusterRetryStrategy: function () {
            this.startupNodes = [{ port: 30002 }];
            return 0;
          },
        }
      );
      let hasDone = false;
      new MockServer(30002, () => {
        if (hasDone) {
          return;
        }
        hasDone = true;
        client.disconnect();
        done();
      });
    });
  });

  describe("scaleReads", () => {
    beforeEach(function () {
      function handler(port, argv) {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [
            [
              0,
              16381,
              ["127.0.0.1", 30001],
              ["127.0.0.1", 30003],
              ["127.0.0.1", 30004],
            ],
            [16382, 16383, ["127.0.0.1", 30002]],
          ];
        }
        return port;
      }
      this.node1 = new MockServer(30001, handler.bind(null, 30001));
      this.node2 = new MockServer(30002, handler.bind(null, 30002));
      this.node3 = new MockServer(30003, handler.bind(null, 30003));
      this.node4 = new MockServer(30004, handler.bind(null, 30004));
    });

    context("master", () => {
      it("should only send reads to master", (done) => {
        const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
        cluster.on("ready", () => {
          const stub = sinon.stub(utils, "sample").throws("sample is called");
          cluster.get("foo", function (err, res) {
            stub.restore();
            expect(res).to.eql(30001);
            cluster.disconnect();
            done();
          });
        });
      });
    });

    context("slave", () => {
      it("should only send reads to slave", (done) => {
        const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
          scaleReads: "slave",
        });
        cluster.on("ready", () => {
          const stub = sinon.stub(utils, "sample").callsFake((array, from) => {
            expect(array).to.eql([
              "127.0.0.1:30001",
              "127.0.0.1:30003",
              "127.0.0.1:30004",
            ]);
            expect(from).to.eql(1);
            return "127.0.0.1:30003";
          });
          cluster.get("foo", function (err, res) {
            stub.restore();
            expect(res).to.eql(30003);
            cluster.disconnect();
            done();
          });
        });
      });

      it("should send writes to masters", (done) => {
        const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
          scaleReads: "slave",
        });
        cluster.on("ready", () => {
          const stub = sinon.stub(utils, "sample").throws("sample is called");
          cluster.set("foo", "bar", function (err, res) {
            stub.restore();
            expect(res).to.eql(30001);
            cluster.disconnect();
            done();
          });
        });
      });

      it("should send custom readOnly scripts to a slave", (done) => {
        const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
          scaleReads: "slave",
        });
        cluster.on("ready", () => {
          const redis: Redis = cluster;
          redis.defineCommand("test", {
            numberOfKeys: 1,
            lua: "return {KEYS[1],ARGV[1],ARGV[2]}",
            readOnly: true,
          });

          const stub = sinon.stub(utils, "sample").returns("127.0.0.1:30003");
          redis.test("k1", "a1", "a2", function (err, result) {
            stub.restore();
            expect(stub.callCount).to.eql(1);
            // because of the beforeEach handler this will be the port of the slave called
            expect(result).to.eql(30003);
            cluster.disconnect();
            done();
          });
        });
      });
    });

    context("custom", () => {
      it("should send to selected slave", (done) => {
        const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
          scaleReads: function (node, command) {
            if (command.name === "get") {
              return node[1];
            }
            return node[2];
          },
        });
        cluster.on("ready", () => {
          const stub = sinon.stub(utils, "sample").callsFake((array, from) => {
            expect(array).to.eql([
              "127.0.0.1:30001",
              "127.0.0.1:30003",
              "127.0.0.1:30004",
            ]);
            expect(from).to.eql(1);
            return "127.0.0.1:30003";
          });
          cluster.hgetall("foo", function (err, res) {
            stub.restore();
            expect(res).to.eql(30004);
            cluster.disconnect();
            done();
          });
        });
      });

      it("should send writes to masters", (done) => {
        const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
          scaleReads: function (node, command) {
            if (command.name === "get") {
              return node[1];
            }
            return node[2];
          },
        });
        cluster.on("ready", () => {
          const stub = sinon.stub(utils, "sample").throws("sample is called");
          cluster.set("foo", "bar", function (err, res) {
            stub.restore();
            expect(res).to.eql(30001);
            cluster.disconnect();
            done();
          });
        });
      });
    });

    context("all", () => {
      it("should send reads to all nodes randomly", (done) => {
        const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
          scaleReads: "all",
        });
        cluster.on("ready", () => {
          const stub = sinon.stub(utils, "sample").callsFake((array, from) => {
            expect(array).to.eql([
              "127.0.0.1:30001",
              "127.0.0.1:30003",
              "127.0.0.1:30004",
            ]);
            expect(from).to.eql(undefined);
            return "127.0.0.1:30003";
          });
          cluster.get("foo", function (err, res) {
            stub.restore();
            expect(res).to.eql(30003);
            cluster.disconnect();
            done();
          });
        });
      });
    });
  });

  describe("#nodes()", () => {
    it("should return the corrent nodes", (done) => {
      const slotTable = [
        [0, 16381, ["127.0.0.1", 30001], ["127.0.0.1", 30003]],
        [16382, 16383, ["127.0.0.1", 30002]],
      ];
      const node = new MockServer(30001, (argv) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return slotTable;
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

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
      // Make sure 30001 has been connected
      cluster.get("foo", () => {
        expect(cluster.nodes()).to.have.lengthOf(3);
        expect(cluster.nodes("all")).to.have.lengthOf(3);
        expect(cluster.nodes("master")).to.have.lengthOf(2);
        expect(cluster.nodes("slave")).to.have.lengthOf(1);

        cluster.once("-node", () => {
          expect(cluster.nodes()).to.have.lengthOf(2);
          expect(cluster.nodes("all")).to.have.lengthOf(2);
          expect(cluster.nodes("master")).to.have.lengthOf(1);
          expect(cluster.nodes("slave")).to.have.lengthOf(1);
          cluster.disconnect();
          done();
        });
        node.disconnect();
      });
    });
  });

  describe("#getInfoFromNode", () => {
    it("should refresh master nodes", (done) => {
      let slotTable = [
        [0, 5460, ["127.0.0.1", 30001], ["127.0.0.1", 30003]],
        [5461, 10922, ["127.0.0.1", 30002]],
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

      new MockServer(30003, (argv) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return slotTable;
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        redisOptions: { showFriendlyErrorStack: true },
      });
      cluster.on("ready", () => {
        expect(cluster.nodes("master")).to.have.lengthOf(2);
        expect(cluster.nodes("all")).to.have.lengthOf(3);
        slotTable = [
          [0, 5460, ["127.0.0.1", 30003]],
          [5461, 10922, ["127.0.0.1", 30002]],
        ];
        cluster.once("-node", function (removed) {
          expect(removed.options.port).to.eql(30001);
          expect(cluster.nodes("master")).to.have.lengthOf(2);
          expect(cluster.nodes("all")).to.have.lengthOf(2);
          expect(
            [
              cluster.nodes("master")[0].options.port,
              cluster.nodes("master")[1].options.port,
            ].sort()
          ).to.eql([30002, 30003]);
          cluster.nodes("master").forEach(function (node) {
            expect(node.options).to.have.property("readOnly", false);
          });
          cluster.disconnect();
          done();
        });
        cluster.refreshSlotsCache();
      });
    });
  });

  describe("#quit()", () => {
    it("should quit the connection gracefully", (done) => {
      const slotTable = [
        [0, 1, ["127.0.0.1", 30001]],
        [2, 16383, ["127.0.0.1", 30002], ["127.0.0.1", 30003]],
      ];
      const argvHandler = function (argv) {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return slotTable;
        }
      };
      new MockServer(30001, argvHandler);
      new MockServer(30002, argvHandler);
      new MockServer(30003, argvHandler);

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);

      let setCommandHandled = false;
      cluster.on("ready", () => {
        cluster.set("foo", "bar", () => {
          setCommandHandled = true;
        });
        cluster.quit(function (err, state) {
          expect(setCommandHandled).to.eql(true);
          expect(state).to.eql("OK");
          cluster.disconnect();
          done();
        });
      });
    });
  });
});
