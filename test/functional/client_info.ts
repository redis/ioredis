import { expect } from "chai";
import Redis, { Cluster } from "../../lib";
import MockServer from "../helpers/mock_server";

describe("clientInfo", function () {
  describe("Redis", function () {
    let redis: Redis;
    let mockServer: MockServer;
    let clientInfoCommands: Array<{ key: string; value: string }>;

    beforeEach(() => {
      clientInfoCommands = [];
      mockServer = new MockServer(30001, (argv) => {
        if (
          argv[0].toLowerCase() === "client" &&
          argv[1].toLowerCase() === "setinfo"
        ) {
          clientInfoCommands.push({
            key: argv[2],
            value: argv[3],
          });
        }
      });
    });

    afterEach(() => {
      mockServer.disconnect();

      if (redis && redis.status !== "end") {
        redis.disconnect();
      }
    });

    it("should send client info by default", async () => {
      redis = new Redis({ port: 30001 });

      // Wait for the client info to be sent, as it happens after the ready event
      await redis.ping();

      expect(clientInfoCommands).to.have.length(2);

      const libVerCommand = clientInfoCommands.find(
        (cmd) => cmd.key === "LIB-VER"
      );
      const libNameCommand = clientInfoCommands.find(
        (cmd) => cmd.key === "LIB-NAME"
      );

      expect(libVerCommand).to.exist;
      expect(libVerCommand?.value).to.be.a("string");
      expect(libVerCommand?.value).to.not.equal("unknown");
      expect(libNameCommand).to.exist;
      expect(libNameCommand?.value).to.equal("ioredis");
    });

    it("should not send client info when disableClientInfo is true", async () => {
      redis = new Redis({ port: 30001, disableClientInfo: true });

      // Wait for the client info to be sent, as it happens after the ready event
      await redis.ping();

      expect(clientInfoCommands).to.have.length(0);
    });

    it("should append tag to library name when clientInfoTag is set", async () => {
      redis = new Redis({ port: 30001, clientInfoTag: "tag-test" });

      // Wait for the client info to be sent, as it happens after the ready event
      await redis.ping();

      expect(clientInfoCommands).to.have.length(2);

      const libNameCommand = clientInfoCommands.find(
        (cmd) => cmd.key === "LIB-NAME"
      );
      expect(libNameCommand).to.exist;
      expect(libNameCommand?.value).to.equal("ioredis(tag-test)");
    });

    it("should send client info after reconnection", async () => {
      redis = new Redis({ port: 30001 });

      // Wait for the client info to be sent, as it happens after the ready event
      await redis.ping();
      redis.disconnect();

      // Make sure the client is disconnected
      await new Promise<void>((resolve) => {
        redis.once("end", () => {
          resolve();
        });
      });

      await redis.connect();
      await redis.ping();

      expect(clientInfoCommands).to.have.length(4);
    });
  });

  describe("Error handling", () => {
    let mockServer: MockServer;
    let redis: Redis;

    afterEach(() => {
      mockServer.disconnect();
      redis.disconnect();
    });

    it("should handle server that doesn't support CLIENT SETINFO", async () => {
      mockServer = new MockServer(30002, (argv) => {
        if (
          argv[0].toLowerCase() === "client" &&
          argv[1].toLowerCase() === "setinfo"
        ) {
          // Simulate older Redis version that doesn't support SETINFO
          return new Error("ERR unknown subcommand 'SETINFO'");
        }
      });

      redis = new Redis({ port: 30002 });
      await redis.ping();

      expect(redis.status).to.equal("ready");
    });
  });

  describe("Cluster", () => {
    let cluster: Cluster;
    let mockServers: MockServer[];
    let clientInfoCommands: Array<{ key: string; value: string }>;
    const slotTable = [
      [0, 5000, ["127.0.0.1", 30001]],
      [5001, 9999, ["127.0.0.1", 30002]],
      [10000, 16383, ["127.0.0.1", 30003]],
    ];

    beforeEach(() => {
      clientInfoCommands = [];

      // Create mock server that handles both cluster commands and client info
      const handler = (argv) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return slotTable;
        }
        if (
          argv[0].toLowerCase() === "client" &&
          argv[1].toLowerCase() === "setinfo"
        ) {
          clientInfoCommands.push({
            key: argv[2],
            value: argv[3],
          });
        }
      };

      mockServers = [
        new MockServer(30001, handler),
        new MockServer(30002, handler),
        new MockServer(30003, handler),
      ];
    });

    afterEach(() => {
      mockServers.forEach((server) => server.disconnect());
      if (cluster) {
        cluster.disconnect();
      }
    });

    it("should send client info by default", async () => {
      cluster = new Redis.Cluster([{ host: "127.0.0.1", port: 30001 }]);

      // Wait for cluster to be ready and send a command to ensure connection
      await cluster.ping();

      // Should have sent 2 SETINFO commands (LIB-VER and LIB-NAME)
      expect(clientInfoCommands).to.have.length.at.least(2);

      const libVerCommand = clientInfoCommands.find(
        (cmd) => cmd.key === "LIB-VER"
      );
      const libNameCommand = clientInfoCommands.find(
        (cmd) => cmd.key === "LIB-NAME"
      );

      expect(libVerCommand).to.exist;
      expect(libVerCommand?.value).to.be.a("string");
      expect(libVerCommand?.value).to.not.equal("unknown");
      expect(libNameCommand).to.exist;
      expect(libNameCommand?.value).to.equal("ioredis");
    });

    it("should propagate disableClientInfo to child nodes", async () => {
      cluster = new Redis.Cluster([{ host: "127.0.0.1", port: 30001 }], {
        redisOptions: {
          disableClientInfo: true,
        },
      });
      await cluster.ping();

      expect(clientInfoCommands).to.have.length(0);
    });
  });
});
