import { expect } from "chai";
import MockServer, { pubSubReply } from "../helpers/mock_server";
import Redis from "../../lib/Redis";

const NOPERM_SUBSCRIBE =
  "NOPERM User has no permissions to run the 'subscribe' command";
const NOPERM_PSUBSCRIBE =
  "NOPERM User has no permissions to run the 'psubscribe' command";
const NOPERM_SELECT =
  "NOPERM User has no permissions to run the 'select' command";

// The fix is protocol-independent, but the reconnect handshake is not: under
// RESP3 the client sends HELLO before replaying state, and subscribe replies
// arrive as push frames rather than arrays. Both are covered, with RESP3 first
// since it is the default in v6.
const PROTOCOLS = [3, 2] as const;

PROTOCOLS.forEach((protocol, index) => {
  describe(`readyHandler state restoration (RESP${protocol})`, () => {
    const basePort = 17900 + index * 10;
    let savedListeners: any[] = [];
    let unhandled: string[] = [];

    beforeEach(() => {
      unhandled = [];
      // test/helpers/global.ts installs an unhandledRejection listener that
      // throws, which would turn a rejection here into an uncaught exception
      // attributed to whichever test happens to be running. Swap it out for a
      // recorder and restore it afterwards.
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

    // Rejects `commandToReject` only from the second connection onwards, so the
    // first connection establishes state normally and only the post-reconnect
    // replay fails.
    function serverRejectingReplayOf(
      port: number,
      commandToReject: string,
      message: string
    ) {
      let connections = 0;
      const server = new MockServer(port, (argv) => {
        const name = String(argv[0]).toLowerCase();
        if (name === "info") {
          return "# Server\r\nredis_version:7.0.0\r\n";
        }
        if (name === commandToReject && connections >= 2) {
          return new Error(message);
        }
        if (name === "subscribe" || name === "psubscribe") {
          return pubSubReply(protocol, name, String(argv[1]), 1);
        }
        return "OK";
      });
      server.on("connect", () => connections++);
      return server;
    }

    function client(port: number) {
      return new Redis({
        port,
        protocol,
        lazyConnect: true,
        retryStrategy: () => 40,
      });
    }

    async function reconnectAndCollect(redis: any, server: MockServer) {
      const errors: string[] = [];
      redis.on("error", (err: Error) => errors.push(err.message));
      // Drop the socket so ioredis reconnects and readyHandler replays state.
      redis.stream.destroy();
      await new Promise((resolve) => setTimeout(resolve, 500));
      redis.disconnect();
      await server.disconnectPromise();
      return errors;
    }

    it("surfaces a failing SUBSCRIBE replay as an error event", async () => {
      const server = serverRejectingReplayOf(
        basePort,
        "subscribe",
        NOPERM_SUBSCRIBE
      );
      const redis = client(basePort);
      await redis.connect();
      await redis.subscribe("news");

      const errors = await reconnectAndCollect(redis, server);

      expect(unhandled, "must not surface as an unhandled rejection").to.eql(
        []
      );
      expect(errors, "the client's error listener must receive it").to.include(
        NOPERM_SUBSCRIBE
      );
    });

    it("surfaces a failing PSUBSCRIBE replay as an error event", async () => {
      const server = serverRejectingReplayOf(
        basePort + 1,
        "psubscribe",
        NOPERM_PSUBSCRIBE
      );
      const redis = client(basePort + 1);
      await redis.connect();
      await redis.psubscribe("news.*");

      const errors = await reconnectAndCollect(redis, server);

      expect(unhandled, "must not surface as an unhandled rejection").to.eql(
        []
      );
      expect(errors, "the client's error listener must receive it").to.include(
        NOPERM_PSUBSCRIBE
      );
    });

    it("surfaces a failing SELECT replay before resubscribing as an error event", async () => {
      // condition.select resets to options.db (0) on reconnect while
      // prevCondition.select is 2, so readyHandler re-selects the db before
      // replaying the subscriptions.
      const server = serverRejectingReplayOf(
        basePort + 2,
        "select",
        NOPERM_SELECT
      );
      const redis = client(basePort + 2);
      await redis.connect();
      await redis.select(2);
      await redis.subscribe("news");

      const errors = await reconnectAndCollect(redis, server);

      expect(unhandled, "must not surface as an unhandled rejection").to.eql(
        []
      );
      expect(errors, "the client's error listener must receive it").to.include(
        NOPERM_SELECT
      );
    });

    it("surfaces a failing SELECT replay on a non-subscriber connection as an error event", async () => {
      // Same restoration, but through the final `select` in readyHandler rather
      // than the subscriber branch.
      const server = serverRejectingReplayOf(
        basePort + 3,
        "select",
        NOPERM_SELECT
      );
      const redis = client(basePort + 3);
      await redis.connect();
      await redis.select(2);

      const errors = await reconnectAndCollect(redis, server);

      expect(unhandled, "must not surface as an unhandled rejection").to.eql(
        []
      );
      expect(errors, "the client's error listener must receive it").to.include(
        NOPERM_SELECT
      );
    });
  });
});
