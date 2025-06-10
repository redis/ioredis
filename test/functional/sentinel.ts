import { Socket } from "net";

import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";
import { once } from "events";
import { expect } from "chai";
import * as sinon from "sinon";

function triggerParseError(socket: Socket) {
  // Valid first characters: '$', '+', '*', ':', '-'
  // To trigger an error, we need to write a different character
  socket.write("A");
}

describe("sentinel", () => {
  describe("connect", () => {
    it("should connect to sentinel successfully", (done) => {
      const sentinel = new MockServer(27379);
      sentinel.once("connect", () => {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      const redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
      });
    });

    it("should default to the default sentinel port", (done) => {
      const sentinel = new MockServer(26379);
      sentinel.once("connect", () => {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      const redis = new Redis({
        sentinels: [{ host: "127.0.0.1" }],
        name: "master",
      });
    });

    it("should try to connect to all sentinel", (done) => {
      const sentinel = new MockServer(27380);
      sentinel.once("connect", () => {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      const redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 },
        ],
        name: "master",
      });
    });

    it("should skip an unresponsive sentinel", async () => {
      const sentinel1 = new MockServer(27379, (_argv, _socket, flags) => {
        flags.hang = true;
      });

      const sentinel2 = new MockServer(27380, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "17380"];
        }
      });

      const master = new MockServer(17380);
      const clock = sinon.useFakeTimers();

      const redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 },
        ],
        name: "master",
        sentinelCommandTimeout: 1000,
      });

      clock.tick(1000);
      clock.restore();
      await once(master, "connect");

      redis.disconnect();
      await Promise.all([
        sentinel1.disconnectPromise(),
        sentinel2.disconnectPromise(),
        master.disconnectPromise(),
      ]);
    });

    it("should call sentinelRetryStrategy when all sentinels are unreachable", (done) => {
      let t = 0;
      const redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 },
        ],
        sentinelRetryStrategy: function (times) {
          expect(times).to.eql(++t);
          const sentinel = new MockServer(27380);
          sentinel.once("connect", () => {
            redis.disconnect();
            sentinel.disconnect(done);
          });
          return 0;
        },
        name: "master",
      });
    });

    it("should raise error when all sentinel are unreachable and retry is disabled", (done) => {
      const redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 },
        ],
        sentinelRetryStrategy: null,
        name: "master",
      });

      redis.get("foo", (error) => {
        finish();
        expect(error.message).to.match(/are unreachable/);
      });

      redis.on("error", (error) => {
        expect(error.message).to.match(/are unreachable/);
        finish();
      });

      redis.on("end", () => {
        finish();
      });

      let pending = 3;
      function finish() {
        if (!--pending) {
          redis.disconnect();
          done();
        }
      }
    });

    it("should close the connection to the sentinel when resolving unsuccessfully", (done) => {
      const sentinel = new MockServer(27379); // Does not respond properly to get-master-addr-by-name
      sentinel.once("disconnect", () => {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      const redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
      });
    });

    it("should add additionally discovered sentinels when resolving successfully", (done) => {
      const sentinels = [{ host: "127.0.0.1", port: 27379 }];
      let cloned;

      sinon.stub(sentinels, "slice").callsFake((start, end) => {
        cloned = [].slice.call(sentinels, start, end);
        return cloned;
      });

      const sentinel = new MockServer(27379, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "17380"];
        } else if (argv[0] === "sentinel" && argv[1] === "sentinels") {
          return [
            ["ip", "127.0.0.1", "port", "27379"],
            ["ip", "127.0.0.1", "port", "27380"],
          ];
        }
      });
      const master = new MockServer(17380);

      const redis = new Redis({
        sentinels: sentinels,
        name: "master",
      });

      redis.on("ready", () => {
        redis.disconnect();
        master.disconnect(() => {
          expect(cloned.length).to.eql(2);
          sentinel.disconnect(done);
        });
      });
    });

    it("should skip additionally discovered sentinels even if they are resolved successfully", (done) => {
      const sentinels = [{ host: "127.0.0.1", port: 27379 }];

      const sentinel = new MockServer(27379, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "17380"];
        } else if (argv[0] === "sentinel" && argv[1] === "sentinels") {
          return [
            ["ip", "127.0.0.1", "port", "27379"],
            ["ip", "127.0.0.1", "port", "27380"],
          ];
        }
      });
      const master = new MockServer(17380);

      const redis = new Redis({
        sentinels: sentinels,
        updateSentinels: false,
        name: "master",
      });

      redis.on("ready", () => {
        redis.disconnect();
        master.disconnect(() => {
          expect(sentinels.length).to.eql(1);
          expect(sentinels[0].port).to.eql(27379);
          sentinel.disconnect(done);
        });
      });
    });

    it("should connect to sentinel with authentication successfully", (done) => {
      let authed = false;
      var redisServer = new MockServer(17380, (argv) => {
        if (argv[0] === "auth" && argv[1] === "pass") {
          authed = true;
        } else if (argv[0] === "get" && argv[1] === "foo") {
          expect(authed).to.eql(true);
          redisServer.disconnect();
          done();
        }
      });
      var sentinel = new MockServer(27379, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          sentinel.disconnect(done);
          return ["127.0.0.1", "17380"];
        }
      });

      const redis = new Redis({
        sentinelPassword: "pass",
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
      });
      redis.get("foo").catch(() => {});
    });
  });

  describe("master", () => {
    it("should connect to the master successfully", (done) => {
      const sentinel = new MockServer(27379, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "17380"];
        }
      });
      const master = new MockServer(17380);
      master.on("connect", () => {
        redis.disconnect();
        sentinel.disconnect(() => {
          master.disconnect(done);
        });
      });

      const redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
      });
    });

    it("should reject when sentinel is rejected", (done) => {
      const sentinel = new MockServer(27379, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return new Error("just rejected");
        }
      });

      const redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
        sentinelRetryStrategy: null,
        lazyConnect: true,
      });

      redis
        .connect()
        .then(() => {
          throw new Error("Expect `connect` to be thrown");
        })
        .catch(function (err) {
          expect(err.message).to.eql(
            "All sentinels are unreachable and retry is disabled. Last error: just rejected"
          );
          redis.disconnect();
          sentinel.disconnect(done);
        });
    });

    it("should connect to the next sentinel if getting master failed", (done) => {
      const sentinel = new MockServer(27379, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return null;
        }
      });

      const sentinel2 = new MockServer(27380);
      sentinel2.on("connect", () => {
        redis.disconnect();
        sentinel.disconnect(() => {
          sentinel2.disconnect(done);
        });
      });

      const redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 },
        ],
        name: "master",
      });
    });

    it("should connect to the next sentinel if the role is wrong", (done) => {
      const sentinel = new MockServer(27379, (argv) => {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "get-master-addr-by-name" &&
          argv[2] === "master"
        ) {
          return ["127.0.0.1", "17380"];
        }
      });

      const sentinel2 = new MockServer(27380);
      sentinel.on("connect", () => {
        redis.disconnect();
        sentinel.disconnect(() => {
          sentinel2.disconnect(done);
        });
      });

      new MockServer(17380, (argv) => {
        if (argv[0] === "info") {
          return "role:slave";
        }
      });

      const redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 },
        ],
        name: "master",
      });
    });
  });

  describe("slave", () => {
    it("should connect to the slave successfully", (done) => {
      const sentinel = new MockServer(27379, (argv) => {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "slaves" &&
          argv[2] === "master"
        ) {
          return [["ip", "127.0.0.1", "port", "17381", "flags", "slave"]];
        }
      });
      const slave = new MockServer(17381);
      slave.on("connect", () => {
        redis.disconnect();
        sentinel.disconnect(() => {
          slave.disconnect(done);
        });
      });

      const redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
        role: "slave",
        preferredSlaves: [{ ip: "127.0.0.1", port: "17381", prio: 10 }],
      });
    });

    it("should connect to the slave successfully based on preferred slave priority", (done) => {
      const sentinel = new MockServer(27379, (argv) => {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "slaves" &&
          argv[2] === "master"
        ) {
          return [
            ["ip", "127.0.0.1", "port", "44444", "flags", "slave"],
            ["ip", "127.0.0.1", "port", "17381", "flags", "slave"],
            ["ip", "127.0.0.1", "port", "55555", "flags", "slave"],
          ];
        }
      });
      const slave = new MockServer(17381);
      slave.on("connect", () => {
        redis.disconnect();
        sentinel.disconnect(() => {
          slave.disconnect(done);
        });
      });

      const redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
        role: "slave",
        // for code coverage (sorting, etc), use multiple valid values that resolve to prio 1
        preferredSlaves: [
          { ip: "127.0.0.1", port: "11111", prio: 100 },
          { ip: "127.0.0.1", port: "17381", prio: 1 },
          { ip: "127.0.0.1", port: "22222", prio: 100 },
          { ip: "127.0.0.1", port: "17381" },
          { ip: "127.0.0.1", port: "17381" },
        ],
      });
    });

    it("should connect to the slave successfully based on preferred slave filter function", (done) => {
      new MockServer(27379, (argv) => {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "slaves" &&
          argv[2] === "master"
        ) {
          return [["ip", "127.0.0.1", "port", "17381", "flags", "slave"]];
        }
      });
      // only one running slave, which we will prefer
      const slave = new MockServer(17381);
      slave.on("connect", () => {
        redis.disconnect();
        done();
      });

      const redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
        role: "slave",
        preferredSlaves(slaves) {
          for (let i = 0; i < slaves.length; i++) {
            const slave = slaves[i];
            if (slave.ip == "127.0.0.1" && slave.port == "17381") {
              return slave;
            }
          }
          return null;
        },
      });
    });

    it("should connect to the next sentinel if getting slave failed", (done) => {
      const sentinel = new MockServer(27379, (argv) => {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "slaves" &&
          argv[2] === "master"
        ) {
          return [];
        }
      });

      const sentinel2 = new MockServer(27380);
      sentinel2.on("connect", () => {
        redis.disconnect();
        sentinel.disconnect(() => {
          sentinel2.disconnect(done);
        });
      });

      const redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 },
        ],
        name: "master",
        role: "slave",
      });
    });

    it("should connect to the next sentinel if the role is wrong", (done) => {
      const sentinel = new MockServer(27379, (argv) => {
        if (
          argv[0] === "sentinel" &&
          argv[1] === "slaves" &&
          argv[2] === "master"
        ) {
          return [["ip", "127.0.0.1", "port", "17381", "flags", "slave"]];
        }
      });

      const sentinel2 = new MockServer(27380);
      sentinel2.on("connect", function (c) {
        redis.disconnect();
        sentinel.disconnect(() => {
          slave.disconnect(() => {
            sentinel2.disconnect(done);
          });
        });
      });

      var slave = new MockServer(17381, (argv) => {
        if (argv[0] === "info") {
          return "role:master";
        }
      });

      const redis = new Redis({
        sentinels: [
          { host: "127.0.0.1", port: 27379 },
          { host: "127.0.0.1", port: 27380 },
        ],
        name: "master",
        role: "slave",
      });
    });
  });

  describe("failover", () => {
    it("should switch to new master automatically without any commands being lost", (done) => {
      const sentinel = new MockServer(27379, (argv) => {
        if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          return ["127.0.0.1", "17380"];
        }
      });
      const master = new MockServer(17380);
      master.on("connect", function (c: Socket) {
        c.destroy();
        master.disconnect();
        redis.get("foo", function (err, res) {
          expect(res).to.eql("bar");
          redis.disconnect();
          newMaster.disconnect(() => {
            sentinel.disconnect(done);
          });
        });
        var newMaster = new MockServer(17381, (argv) => {
          if (argv[0] === "get" && argv[1] === "foo") {
            return "bar";
          }
        });
        sentinel.handler = function (argv) {
          if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
            return ["127.0.0.1", "17381"];
          }
        };
      });

      const redis = new Redis({
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
      });
    });

    describe("failoverDetector", () => {
      it("should connect to new master after +switch-master", async () => {
        const sentinel = new MockServer(27379, (argv) => {
          if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
            return ["127.0.0.1", "17380"];
          }
        });
        const master = new MockServer(17380);
        const newMaster = new MockServer(17381);

        const redis = new Redis({
          sentinels: [{ host: "127.0.0.1", port: 27379 }],
          failoverDetector: true,
          name: "master",
        });

        await Promise.all([
          once(master, "connect"),
          once(redis, "failoverSubscribed"),
        ]);

        sentinel.handler = function (argv) {
          if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
            return ["127.0.0.1", "17381"];
          }
        };

        sentinel.broadcast([
          "message",
          "+switch-master",
          "master 127.0.0.1 17380 127.0.0.1 17381",
        ]);

        await Promise.all([
          once(redis, "close"), // Wait until disconnects from old master
          once(master, "disconnect"),
          once(newMaster, "connect"),
        ]);

        redis.disconnect(); // Disconnect from new master

        await Promise.all([
          sentinel.disconnectPromise(),
          master.disconnectPromise(),
          newMaster.disconnectPromise(),
        ]);
      });

      it("should detect failover from secondary sentinel", async () => {
        const sentinel1 = new MockServer(27379, (argv) => {
          if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
            return ["127.0.0.1", "17380"];
          }
        });
        const sentinel2 = new MockServer(27380);
        const master = new MockServer(17380);
        const newMaster = new MockServer(17381);

        const redis = new Redis({
          sentinels: [
            { host: "127.0.0.1", port: 27379 },
            { host: "127.0.0.1", port: 27380 },
          ],
          name: "master",
          failoverDetector: true,
        });

        await Promise.all([
          once(master, "connect"),
          once(redis, "failoverSubscribed"),
        ]);

        // In this test, only the first sentinel is used to resolve the master
        sentinel1.handler = function (argv) {
          if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
            return ["127.0.0.1", "17381"];
          }
        };

        // But only the second sentinel broadcasts +switch-master
        sentinel2.broadcast([
          "message",
          "+switch-master",
          "master 127.0.0.1 17380 127.0.0.1 17381",
        ]);

        await Promise.all([
          once(redis, "close"), // Wait until disconnects from old master
          once(master, "disconnect"),
          once(newMaster, "connect"),
        ]);

        redis.disconnect(); // Disconnect from new master

        await Promise.all([
          sentinel1.disconnectPromise(),
          sentinel2.disconnectPromise(),
          master.disconnectPromise(),
          newMaster.disconnectPromise(),
        ]);
      });

      it("should detect failover when some sentinels fail", async () => {
        // Will disconnect before failover
        const sentinel1 = new MockServer(27379, (argv) => {
          if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
            return ["127.0.0.1", "17380"];
          }
        });

        // Will emit an error before failover
        let sentinel2Socket: Socket | null = null;
        const sentinel2 = new MockServer(27380, (argv, socket) => {
          sentinel2Socket = socket;
        });

        // Fails to subscribe
        const sentinel3 = new MockServer(27381, (argv, socket, flags) => {
          if (argv[0] === "subscribe") {
            triggerParseError(socket);
          }
        });

        // The only sentinel that can successfully publish the failover message
        const sentinel4 = new MockServer(27382);

        const master = new MockServer(17380);
        const newMaster = new MockServer(17381);

        const redis = new Redis({
          sentinels: [
            { host: "127.0.0.1", port: 27379 },
            { host: "127.0.0.1", port: 27380 },
            { host: "127.0.0.1", port: 27381 },
            { host: "127.0.0.1", port: 27382 },
          ],
          name: "master",
          failoverDetector: true,
        });

        await Promise.all([
          once(master, "connect"),

          // Must resolve even though subscribing to sentinel3 fails
          once(redis, "failoverSubscribed"),
        ]);

        // Fail sentinels 1 and 2
        await sentinel1.disconnectPromise();
        triggerParseError(sentinel2Socket);

        sentinel4.handler = function (argv) {
          if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
            return ["127.0.0.1", "17381"];
          }
        };

        sentinel4.broadcast([
          "message",
          "+switch-master",
          "master 127.0.0.1 17380 127.0.0.1 17381",
        ]);

        await Promise.all([
          once(redis, "close"), // Wait until disconnects from old master
          once(master, "disconnect"),
          once(newMaster, "connect"),
        ]);

        redis.disconnect(); // Disconnect from new master

        await Promise.all([
          // sentinel1 is already disconnected
          sentinel2.disconnectPromise(),
          sentinel3.disconnectPromise(),
          sentinel4.disconnectPromise(),
          master.disconnectPromise(),
          newMaster.disconnectPromise(),
        ]);
      });

      it("should detect failover after sentinel disconnects and reconnects", async () => {
        const sentinel = new MockServer(27379, (argv) => {
          if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
            return ["127.0.0.1", "17380"];
          }
        });

        const master = new MockServer(17380);
        const newMaster = new MockServer(17381);

        const redis = new Redis({
          sentinels: [{ host: "127.0.0.1", port: 27379 }],
          name: "master",
          sentinelReconnectStrategy: () => 1000,
          failoverDetector: true,
        });

        await Promise.all([
          once(master, "connect"),
          once(redis, "failoverSubscribed"),
        ]);

        await sentinel.disconnectPromise();

        sentinel.handler = function (argv) {
          if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
            return ["127.0.0.1", "17381"];
          }
          if (argv[0] === "subscribe") {
            sentinel.emit("test:resubscribed"); // Custom event only used in tests
          }
        };

        sentinel.connect();

        const clock = sinon.useFakeTimers();
        await once(redis, "sentinelReconnecting"); // Wait for the timeout to be set
        clock.tick(1000);
        clock.restore();
        await once(sentinel, "test:resubscribed");

        sentinel.broadcast([
          "message",
          "+switch-master",
          "master 127.0.0.1 17380 127.0.0.1 17381",
        ]);

        await Promise.all([
          once(redis, "close"), // Wait until disconnects from old master
          once(master, "disconnect"),
          once(newMaster, "connect"),
        ]);

        redis.disconnect(); // Disconnect from new master

        await Promise.all([
          sentinel.disconnectPromise(),
          master.disconnectPromise(),
          newMaster.disconnectPromise(),
        ]);
      });
    });
  });

  describe("sentinel password function support", () => {
    it("should support static string sentinelPassword (baseline)", (done) => {
      let sentinelAuthed = false;
      const sentinel = new MockServer(27379, (argv) => {
        if (argv[0] === "auth" && argv[1] === "staticsentinelpass") {
          sentinelAuthed = true;
        } else if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          expect(sentinelAuthed).to.eql(true);
          sentinel.disconnect();
          redis.disconnect();
          done();
          return ["127.0.0.1", "17380"];
        }
      });

      const redis = new Redis({
        sentinelPassword: "staticsentinelpass",
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
      });
    });

    it("should support sync function sentinelPassword", (done) => {
      let sentinelAuthed = false;
      let callCount = 0;
      const passwordFunction = () => {
        callCount++;
        return "syncsentinelpass";
      };

      const sentinel = new MockServer(27379, (argv) => {
        if (argv[0] === "auth" && argv[1] === "syncsentinelpass") {
          sentinelAuthed = true;
        } else if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          expect(sentinelAuthed).to.eql(true);
          expect(callCount).to.eql(1);
          sentinel.disconnect();
          redis.disconnect();
          done();
          return ["127.0.0.1", "17380"];
        }
      });

      const redis = new Redis({
        sentinelPassword: passwordFunction,
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
      });
    });

    it("should support async function sentinelPassword", (done) => {
      let sentinelAuthed = false;
      let callCount = 0;
      const passwordFunction = async () => {
        callCount++;
        return new Promise(resolve => setTimeout(() => resolve("asyncsentinelpass"), 10));
      };

      const sentinel = new MockServer(27379, (argv) => {
        if (argv[0] === "auth" && argv[1] === "asyncsentinelpass") {
          sentinelAuthed = true;
        } else if (argv[0] === "sentinel" && argv[1] === "get-master-addr-by-name") {
          expect(sentinelAuthed).to.eql(true);
          expect(callCount).to.eql(1);
          sentinel.disconnect();
          redis.disconnect();
          done();
          return ["127.0.0.1", "17380"];
        }
      });

      const redis = new Redis({
        sentinelPassword: passwordFunction,
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
      });
    });

    it("should handle sentinelPassword function errors gracefully", (done) => {
      const passwordFunction = () => {
        throw new Error("Sentinel password retrieval failed");
      };

      const redis = new Redis({
        sentinelPassword: passwordFunction,
        sentinels: [{ host: "127.0.0.1", port: 27379 }],
        name: "master",
      });

      redis.on("error", (error) => {
        expect(error.message).to.include("Sentinel password retrieval failed");
        redis.disconnect();
        done();
      });
    });
  });
});
