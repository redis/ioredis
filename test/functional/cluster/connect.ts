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

  it("should reset retry times when connect() is called after giving up", (done) => {
    const timesSeen: number[] = [];

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      clusterRetryStrategy(times) {
        timesSeen.push(times);
        return times > 2 ? null : 0;
      },
    });

    let endCount = 0;
    cluster.on("end", () => {
      endCount++;

      if (endCount === 1) {
        cluster.connect().catch(() => {});
        return;
      }

      expect(timesSeen).to.eql([1, 2, 3, 1, 2, 3]);
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

  it("should using the specified password - RESP 2", (done) => {
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
      { redisOptions: { lazyConnect: false, password: "default password", protocol: 2 } },
    );
  });

  it("should using the specified password - RESP 3", (done) => {
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
      if (argv[0] === "hello") {
        const password = argv[4];
        if (port === 30001) {
          expect(password).to.eql("other password");
        } else if (port === 30002 && password) {
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
      { redisOptions: { lazyConnect: false, password: "default password", protocol: 3 } },
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
      new MockServer(30001);
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

  describe("commandTimeout", () => {
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    let cluster: Cluster;

    afterEach(() => {
      cluster?.disconnect();
    });

    // Records the commands a node receives, apart from the cluster commands
    // used to load the slots.
    function createHandler(received: string[]) {
      return (argv) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return slotTable;
        }
        if (argv[0] === "cluster" && argv[1] === "INFO") {
          return "cluster_state:ok";
        }
        received.push(argv[0]);
        if (argv[0] === "get") {
          return "bar";
        }
      };
    }

    function createCluster(commandTimeout: number) {
      return new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        clusterRetryStrategy: () => 50,
        redisOptions: { commandTimeout },
      });
    }

    it("rejects a command that waits too long for the cluster to be ready", (done) => {
      cluster = createCluster(100);

      const start = Date.now();
      cluster.get("foo", (err) => {
        expect(err.message).to.eql("Command timed out");
        expect(Date.now() - start).to.be.below(1000);
        done();
      });
    });

    it("does not send a timed out command once the cluster is ready", (done) => {
      const received: string[] = [];
      cluster = createCluster(100);

      cluster.set("foo", "bar", (err) => {
        expect(err.message).to.eql("Command timed out");
        new MockServer(30001, createHandler(received));
        cluster.once("ready", () => {
          cluster.get("foo", (getErr, res) => {
            expect(getErr).to.eql(null);
            expect(res).to.eql("bar");
            expect(received).to.not.include("set");
            done();
          });
        });
      });
    });

    it("sends a queued command once the cluster is ready within the timeout", (done) => {
      cluster = createCluster(2000);

      cluster.get("foo", (err, res) => {
        expect(err).to.eql(null);
        expect(res).to.eql("bar");
        done();
      });
      setTimeout(() => new MockServer(30001, createHandler([])), 100);
    });

    it("does not send a command that timed out while the cluster reconnects", (done) => {
      const received: string[] = [];
      const server = new MockServer(30001, createHandler(received));
      cluster = createCluster(100);

      cluster.once("ready", () => {
        cluster.once("reconnecting", () => {
          cluster.set("foo", "bar", (err) => {
            expect(err.message).to.eql("Command timed out");
            new MockServer(30001, createHandler(received));
            cluster.once("ready", () => {
              cluster.get("foo", (getErr, res) => {
                expect(getErr).to.eql(null);
                expect(res).to.eql("bar");
                expect(received).to.not.include("set");
                done();
              });
            });
          });
        });
        server.disconnect();
      });
    });

    it("lets pipelined commands wait while the cluster reconnects", (done) => {
      const received: string[] = [];
      const server = new MockServer(30001, createHandler(received));
      cluster = createCluster(100);

      cluster.once("ready", () => {
        cluster.once("reconnecting", () => {
          // A pipeline retries commands that fail with the same error, so a
          // timeout here would not stop the SET from running later. It waits.
          cluster
            .pipeline()
            .set("foo", "bar")
            .exec((err, res) => {
              expect(err).to.eql(null);
              expect(res).to.eql([[null, "OK"]]);
              const sets = received.filter((name) => name === "set");
              expect(sets).to.have.length(1);
              done();
            });
          setTimeout(() => new MockServer(30001, createHandler(received)), 300);
        });
        server.disconnect();
      });
    });
  });
});
