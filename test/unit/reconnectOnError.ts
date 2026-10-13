import { expect } from "chai";
import MockServer from "../helpers/mock_server";
import Redis from "../../lib/Redis";

const READONLY_ERROR = "READONLY You can't write against a read only replica.";
const INVALID_DB_INDEX = "ERR DB index is out of range";

// The restoring `SELECT` is protocol-independent, but the connection setup
// around it is not: under RESP3 the client sends HELLO before anything else.
const PROTOCOLS = [3, 2] as const;

PROTOCOLS.forEach((protocol, index) => {
  describe(`reconnectOnError db restoration (RESP${protocol})`, () => {
    const port = 17930 + index;
    let savedListeners: any[] = [];
    let unhandled: string[] = [];

    beforeEach(() => {
      unhandled = [];
      // test/helpers/global.ts installs an unhandledRejection listener that
      // throws; record rejections here instead and restore it afterwards.
      savedListeners = process.listeners("unhandledRejection");
      process.removeAllListeners("unhandledRejection");
      process.on("unhandledRejection", (reason) => {
        unhandled.push(String(reason));
      });
    });

    afterEach(() => {
      process.removeAllListeners("unhandledRejection");
      for (const listener of savedListeners) {
        process.on("unhandledRejection", listener);
      }
    });

    it("surfaces a failing db-restoring SELECT as an error event", async () => {
      // `get` fails on the first connection only, so reconnectOnError fires
      // once; `select` fails from the reconnect onwards.
      let connections = 0;
      const server = new MockServer(port, (argv) => {
        const name = String(argv[0]).toLowerCase();
        if (name === "info") {
          return "# Server\r\nredis_version:7.0.0\r\n";
        }
        if (name === "get" && connections < 2) {
          return new Error(READONLY_ERROR);
        }
        if (name === "select" && connections >= 2) {
          return new Error(INVALID_DB_INDEX);
        }
        return "OK";
      });
      server.on("connect", () => connections++);

      const redis = new Redis({
        port,
        protocol,
        lazyConnect: true,
        retryStrategy: () => 40,
        // 2 = reconnect and resend, the branch that restores the command's db.
        reconnectOnError: (err: Error) =>
          err.message.startsWith("READONLY") ? 2 : false,
      });
      const errors: string[] = [];
      redis.on("error", (err: Error) => errors.push(err.message));
      await redis.connect();

      // `select(2)` is sent before the `get` reply arrives, so the failed
      // `get` (issued against db 0) needs its db restored before the resend.
      await Promise.all([
        redis.get("foo").catch(() => {}),
        redis.select(2).catch(() => {}),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 500));

      redis.disconnect();
      await server.disconnectPromise();

      expect(unhandled).to.eql([]);
      expect(errors).to.include(INVALID_DB_INDEX);
    });
  });
});
