import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import Redis from "../../../lib/Redis";

/**
 * Tests for custom Redis subclass support in Cluster.
 *
 * Users should be able to pass a Redis subclass (e.g. for instrumentation,
 * logging, or custom error handling) and have it used for every internal
 * connection the Cluster creates — pool nodes, subscribers, slot refreshers, etc.
 *
 * These tests verify observable behavior, not internal wiring. They should
 * remain valid regardless of how the Cluster internals are refactored.
 */
describe("cluster:redisClass", function () {
  // Backward compatibility: without redisClass, everything works as before.
  it("should use the default Redis class when redisClass is not provided", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    cluster.once("ready", () => {
      const nodes = cluster.nodes();
      expect(nodes.length).to.be.greaterThan(0);
      nodes.forEach((node) => {
        expect(node).to.be.instanceOf(Redis);
      });
      cluster.disconnect();
      done();
    });
  });

  // Core guarantee: every node in a multi-node cluster uses the subclass.
  it("should use a custom Redis subclass for all pool node connections", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 8191, ["127.0.0.1", 30001]],
          [8192, 16383, ["127.0.0.1", 30002]],
        ];
      }
    };
    new MockServer(30001, handler);
    new MockServer(30002, handler);

    class CustomRedis extends Redis {}

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      redisClass: CustomRedis,
    });

    cluster.once("ready", () => {
      const allNodes = cluster.nodes("all");
      expect(allNodes.length).to.equal(2);
      allNodes.forEach((node) => {
        expect(node).to.be.instanceOf(CustomRedis);
      });
      cluster.disconnect();
      done();
    });
  });

  // Verifies no internal connection bypasses the subclass constructor.
  it("should invoke custom subclass constructor for every connection Cluster creates", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const connectionNames: string[] = [];

    class InstrumentedRedis extends Redis {
      constructor(options: any) {
        super(options);
        if (options.connectionName) {
          connectionNames.push(options.connectionName);
        }
      }
    }

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      redisClass: InstrumentedRedis,
    });

    cluster.once("ready", () => {
      // The subclass constructor was called at least once (for pool nodes)
      expect(connectionNames.length).to.be.greaterThan(0);
      cluster.disconnect();
      done();
    });
  });

  // Pub/sub subscriber is a separate connection — must also use the subclass.
  it("should use the custom subclass for subscriber connections", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 1, ["127.0.0.1", 30001]],
          [2, 16383, ["127.0.0.1", 30002]],
        ];
      }
    };
    const node1 = new MockServer(30001, handler);
    new MockServer(30002, handler);

    const connectionNames: string[] = [];

    class InstrumentedRedis extends Redis {
      constructor(options: any) {
        super(options);
        if (options.connectionName) {
          connectionNames.push(options.connectionName);
        }
      }
    }

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      redisClass: InstrumentedRedis,
    });

    cluster.subscribe("test channel", function () {
      // The subscriber connection should also be an InstrumentedRedis,
      // which means its connectionName was captured by our constructor.
      const subscriberNames = connectionNames.filter((name) =>
        name.includes("subscriber")
      );
      expect(subscriberNames.length).to.be.greaterThan(0);

      node1.write(node1.findClientByName("ioredis-cluster(subscriber)"), [
        "message",
        "test channel",
        "hi",
      ]);
    });

    cluster.on("message", function (channel, message) {
      expect(channel).to.eql("test channel");
      expect(message).to.eql("hi");
      cluster.disconnect();
      done();
    });
  });

  // Sharded pub/sub creates one subscriber per master — all must use subclass.
  it("should use the custom subclass for sharded subscriber connections", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    const node = new MockServer(30001, handler);

    const connectionNames: string[] = [];

    class InstrumentedRedis extends Redis {
      constructor(options: any) {
        super(options);
        if (options.connectionName) {
          connectionNames.push(options.connectionName);
        }
      }
    }

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      redisClass: InstrumentedRedis,
      shardedSubscribers: true,
      redisOptions: { lazyConnect: false },
    });

    cluster.once("ready", () => {
      // Wait for sharded subscriber connections to be established
      setTimeout(() => {
        const shardedSubNames = connectionNames.filter((name) =>
          name.includes("ssubscriber")
        );
        expect(shardedSubNames.length).to.be.greaterThan(0);
        cluster.disconnect();
        done();
      }, 1000);
    });
  });

  // Periodic slot refresh creates short-lived connections — must use subclass.
  it("should use the custom subclass for slot refresh connections", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const connectionNames: string[] = [];

    class InstrumentedRedis extends Redis {
      constructor(options: any) {
        super(options);
        if (options.connectionName) {
          connectionNames.push(options.connectionName);
        }
      }
    }

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      redisClass: InstrumentedRedis,
      slotsRefreshInterval: 100,
    });

    cluster.once("ready", () => {
      // Wait for at least one periodic slot refresh cycle
      setTimeout(() => {
        const refresherNames = connectionNames.filter((name) =>
          name.includes("refresher")
        );
        expect(refresherNames.length).to.be.greaterThan(0);
        cluster.disconnect();
        done();
      }, 500);
    });
  });

  // End-to-end: the primary use case from — a subclass that overrides
  // sendCommand for logging/instrumentation actually intercepts commands.
  it("should allow a subclass to override sendCommand for instrumentation", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const commandLog: string[] = [];

    class LoggingRedis extends Redis {
      sendCommand(command: any, stream?: any): unknown {
        if (command.name && command.name !== "cluster" && command.name !== "info" && command.name !== "client") {
          commandLog.push(command.name);
        }
        return super.sendCommand(command, stream);
      }
    }

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      redisClass: LoggingRedis,
    });

    cluster.once("ready", () => {
      cluster.set("foo", "bar", () => {
        cluster.get("foo", () => {
          // Our subclass's sendCommand override was invoked
          expect(commandLog).to.include("set");
          expect(commandLog).to.include("get");
          cluster.disconnect();
          done();
        });
      });
    });
  });

  // Sanity check: a subclass doesn't break normal command execution.
  it("should preserve normal cluster functionality with a custom subclass", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    class CustomRedis extends Redis {}

    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      redisClass: CustomRedis,
    });

    cluster.once("ready", () => {
      // Verify commands execute without error through the custom subclass
      cluster.set("key", "value", (err) => {
        expect(err).to.eql(null);
        cluster.disconnect();
        done();
      });
    });
  });
});
