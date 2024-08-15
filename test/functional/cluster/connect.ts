import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";

describe("cluster:connect", () => {
  it("should flush the queue when all startup nodes are unreachable", (done) => {
    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      clusterRetryStrategy: null,
    });

    cluster.get("foo", function (err) {
      expect(err.message).to.match(/None of startup nodes is available/);
      cluster.disconnect();
      done();
    });
  });

  it("should invoke clusterRetryStrategy when all startup nodes are unreachable", (done) => {
    let t = 0;
    const cluster = new Cluster(
      [
        { host: "127.0.0.1", port: "30001" },
        { host: "127.0.0.1", port: "30002" },
      ],
      {
        clusterRetryStrategy: function (times) {
          expect(times).to.eql(++t);
          if (times === 3) {
            return;
          }
          return 0;
        },
      }
    );

    cluster.get("foo", function (err) {
      expect(t).to.eql(3);
      expect(err.message).to.match(/None of startup nodes is available/);
      cluster.disconnect();
      done();
    });
  });

  it("should invoke clusterRetryStrategy when none nodes are ready", (done) => {
    const argvHandler = function (argv) {
      if (argv[0] === "cluster") {
        return new Error("CLUSTERDOWN");
      }
    };
    new MockServer(30001, argvHandler);
    new MockServer(30002, argvHandler);

    let t = 0;
    var cluster = new Cluster(
      [
        { host: "127.0.0.1", port: "30001" },
        { host: "127.0.0.1", port: "30002" },
      ],
      {
        clusterRetryStrategy: function (times) {
          expect(times).to.eql(++t);
          if (times === 3) {
            cluster.disconnect();
            done();
            return;
          }
          return 0;
        },
      }
    );
  });

  it("should connect to cluster successfully", (done) => {
    const node = new MockServer(30001);

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);

    node.once("connect", () => {
      cluster.disconnect();
      done();
    });
  });

  it("should wait for ready state before resolving", (done) => {
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    const argvHandler = function (argv) {
      if (argv[0] === "info") {
        // return 'role:master'
      }
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "cluster" && argv[1] === "INFO") {
        return "cluster_state:ok";
      }
    };
    new MockServer(30001, argvHandler);

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      lazyConnect: true,
    });

    cluster.connect().then(() => {
      expect(cluster.status).to.eql("ready");
      cluster.disconnect();
      done();
    });
  });

  it("should support url schema", (done) => {
    const node = new MockServer(30001);

    const cluster = new Cluster(["redis://127.0.0.1:30001"]);

    node.once("connect", () => {
      cluster.disconnect();
      done();
    });
  });

  it("should support a single port", (done) => {
    const node = new MockServer(30001);

    const cluster = new Cluster([30001]);

    node.once("connect", () => {
      cluster.disconnect();
      done();
    });
  });

  it("should return a promise to be resolved when connected", (done) => {
    const slotTable = [
      [0, 5460, ["127.0.0.1", 30001]],
      [5461, 10922, ["127.0.0.1", 30002]],
      [10923, 16383, ["127.0.0.1", 30003]],
    ];
    const argvHandler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    };
    new MockServer(30001, argvHandler);
    new MockServer(30002, argvHandler);
    new MockServer(30003, argvHandler);

    const stub = sinon
      .stub(Cluster.prototype, "connect")
      .callsFake(() => Promise.resolve());
    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      lazyConnect: false,
    });
    stub.restore();

    cluster.connect().then(() => {
      cluster.disconnect();
      done();
    });
  });

  it("should return a promise to be rejected when closed", (done) => {
    const stub = sinon
      .stub(Cluster.prototype, "connect")
      .callsFake(() => Promise.resolve());
    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      lazyConnect: false,
    });
    stub.restore();

    cluster.connect().catch(() => {
      cluster.disconnect();
      done();
    });
  });

  it("should stop reconnecting when disconnected", (done) => {
    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      clusterRetryStrategy: () => {
        return 0;
      },
    });

    cluster.on("close", () => {
      cluster.disconnect();
      const stub = sinon
        .stub(Cluster.prototype, "connect")
        .throws(new Error("`connect` should not be called"));
      setTimeout(() => {
        stub.restore();
        done();
      }, 1);
    });
  });

  it("should discover other nodes automatically", (done) => {
    const slotTable = [
      [0, 5460, ["127.0.0.1", 30001]],
      [5461, 10922, ["127.0.0.1", 30002]],
      [10923, 16383, ["127.0.0.1", 30003]],
    ];
    const argvHandler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    };
    const node1 = new MockServer(30001, argvHandler);
    const node2 = new MockServer(30002, argvHandler);
    const node3 = new MockServer(30003, argvHandler);

    let pending = 3;
    node1.once("connect", check);
    node2.once("connect", check);
    node3.once("connect", check);

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      redisOptions: { lazyConnect: false },
    });

    function check() {
      if (!--pending) {
        cluster.disconnect();
        done();
      }
    }
  });

  it("should send command to the correct node", (done) => {
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
        process.nextTick(() => {
          cluster.disconnect();
          done();
        });
      }
    });

    var cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      lazyConnect: false,
    });
    cluster.get("foo");
  });

  it("should emit errors when cluster cannot be connected", (done) => {
    const errorMessage = "ERR This instance has cluster support disabled";
    const argvHandler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return new Error(errorMessage);
      }
    };
    new MockServer(30001, argvHandler);
    new MockServer(30002, argvHandler);

    let pending = 2;
    let retry: number | null = 0;
    var cluster = new Cluster(
      [
        { host: "127.0.0.1", port: "30001" },
        { host: "127.0.0.1", port: "30002" },
      ],
      {
        clusterRetryStrategy: () => {
          cluster.once("error", function (err) {
            retry = null;
            expect(err.message).to.eql("Failed to refresh slots cache.");
            expect(err.lastNodeError.message).to.eql(errorMessage);
            checkDone();
          });
          return retry;
        },
      }
    );

    cluster.once("node error", function (err, key) {
      expect(err.message).to.eql(errorMessage);
      expect(["127.0.0.1:30001", "127.0.0.1:30002"]).to.include(key);
      checkDone();
    });

    function checkDone() {
      if (!--pending) {
        cluster.disconnect();
        done();
      }
    }
  });

  it("should using the specified password", (done) => {
    let cluster;
    const slotTable = [
      [0, 5460, ["127.0.0.1", 30001]],
      [5461, 10922, ["127.0.0.1", 30002]],
      [10923, 16383, ["127.0.0.1", 30003]],
    ];
    const argvHandler = function (port, argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "auth") {
        const password = argv[1];
        if (port === 30001) {
          expect(password).to.eql("other password");
        } else if (port === 30002) {
          throw new Error("30002 got password");
        } else if (port === 30003) {
          expect(password).to.eql("default password");
          cluster.disconnect();
          done();
        }
      }
    };
    new MockServer(30001, argvHandler.bind(null, 30001));
    new MockServer(30002, argvHandler.bind(null, 30002));
    new MockServer(30003, argvHandler.bind(null, 30003));

    cluster = new Cluster(
      [
        { host: "127.0.0.1", port: "30001", password: "other password" },
        { host: "127.0.0.1", port: "30002", password: null },
      ],
      { redisOptions: { lazyConnect: false, password: "default password" } }
    );
  });

  it("should discover other nodes automatically every slotsRefreshInterval", (done) => {
    let times = 0;
    let cluster;
    const argvHandler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        times++;
        if (times === 1) {
          return [
            [0, 5460, ["127.0.0.1", 30001]],
            [5461, 10922, ["127.0.0.1", 30001]],
            [10923, 16383, ["127.0.0.1", 30001]],
          ];
        }

        return [
          [0, 5460, ["127.0.0.1", 30001]],
          [5461, 10922, ["127.0.0.1", 30001]],
          [10923, 16383, ["127.0.0.1", 30002]],
        ];
      }
    };
    const node1 = new MockServer(30001, argvHandler);
    const node2 = new MockServer(30002, argvHandler);

    node1.once("connect", () => {
      node2.once("connect", () => {
        cluster.disconnect();
        done();
      });
    });

    cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      slotsRefreshInterval: 100,
      redisOptions: { lazyConnect: false },
    });
  });

  it("throws when startupNodes is empty", (done) => {
    const message = "`startupNodes` should contain at least one node.";
    let pending = 2;
    const cluster = new Cluster(null, {
      lazyConnect: true,
      clusterRetryStrategy(_, reason) {
        expect(reason.message).to.eql(message);
        if (!--pending) {
          done();
        }
        return null;
      },
    });
    cluster.connect().catch((err) => {
      expect(err.message).to.eql(message);
      cluster.disconnect();
      if (!--pending) {
        done();
      }
    });
  });

  describe("multiple reconnect", () => {
    it("should reconnect after multiple consecutive disconnect(true) are called", (done) => {
      const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
      new MockServer(30001, (argv) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return slotTable;
        }
      });
      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        enableReadyCheck: false,
      });
      cluster.once("reconnecting", () => {
        cluster.disconnect(true);
      });
      cluster.once("ready", () => {
        cluster.disconnect(true);
        const rejectTimeout = setTimeout(() => {
          cluster.disconnect();
          done(new Error("second disconnect(true) didn't reconnect redis"));
        }, 1000);
        process.nextTick(() => {
          cluster.once("ready", () => {
            clearTimeout(rejectTimeout);
            cluster.disconnect();
            done();
          });
        });
      });
    });
  });
});
