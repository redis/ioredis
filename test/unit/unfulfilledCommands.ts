import { expect } from "chai";
import MockServer from "../helpers/mock_server";
import Redis from "../../lib/Redis";

// In-flight commands are stashed in `prevCommandQueue` when a ready connection
// drops, and only `readyHandler` drains that stash. A client that ends before
// reaching "ready" again therefore has to settle it from the flush path. Both
// protocols are covered since the reconnect handshake differs between them.
const PROTOCOLS = [3, 2] as const;

PROTOCOLS.forEach((protocol, index) => {
  describe(`unfulfilled commands of a client that never becomes ready again (RESP${protocol})`, () => {
    const basePort = 17950 + index * 10;
    let attempts = 0;

    beforeEach(() => {
      attempts = 0;
    });

    // Serves the first connection normally but never replies to `get`, so that
    // command is still in flight when the socket drops. Every later connection
    // is handed to `afterReconnect`, which keeps the reconnect from ever
    // reaching "ready".
    function serverReadyOnce(
      port: number,
      afterReconnect: (socket: any) => void
    ) {
      let connections = 0;
      const server = new MockServer(port, (argv, socket, flags) => {
        if (connections >= 2) {
          flags.hang = true;
          afterReconnect(socket);
          return;
        }
        const name = String(argv[0]).toLowerCase();
        if (name === "info") {
          return "# Server\r\nredis_version:7.0.0\r\n";
        }
        if (name === "get") {
          flags.hang = true;
          return;
        }
        return "OK";
      });
      server.on("connect", () => connections++);
      return server;
    }

    function track(promise: Promise<unknown>) {
      const state = { settlement: "pending" };
      promise.then(
        (value) => (state.settlement = `resolved: ${value}`),
        (err: Error) => (state.settlement = `rejected: ${err.message}`)
      );
      return state;
    }

    async function waitFor(predicate: () => boolean, what: string) {
      for (let i = 0; i < 100; i++) {
        if (predicate()) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`timed out waiting for ${what}`);
    }

    // Brings the client to "ready" with one command in flight, then drops the
    // socket so `closeHandler` stashes that command in `prevCommandQueue`.
    async function readyClientWithInFlightCommand(
      port: number,
      options: Record<string, unknown> = {}
    ) {
      const redis = new Redis({
        port,
        protocol,
        lazyConnect: true,
        retryStrategy: () => 50,
        ...options,
      });
      redis.on("error", () => {});
      await redis.connect();

      const pending = track(redis.get("foo") as Promise<unknown>);
      await waitFor(() => redis.commandQueue.length > 0, "GET to be in flight");
      redis.stream.destroy();

      return { redis, pending };
    }

    it("rejects them when the user disconnects mid-reconnect", async () => {
      const server = serverReadyOnce(basePort, () => {});
      const { redis, pending } = await readyClientWithInFlightCommand(basePort);

      // The reconnect replaces `commandQueue`, which is what leaves the stash
      // unreachable from `flushQueue`.
      await waitFor(
        () => redis.status === "connect",
        "the client to reconnect"
      );
      redis.disconnect();
      await waitFor(() => redis.status === "end", "the client to end");
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(pending.settlement).to.equal("rejected: Connection is closed.");

      await server.disconnectPromise();
    });

    it("rejects them when the retry strategy gives up", async () => {
      // Drops the second connection so `retryStrategy` is consulted again and
      // ends the client without any user call.
      const server = serverReadyOnce(basePort + 1, (socket) =>
        socket.destroy()
      );
      const { redis, pending } = await readyClientWithInFlightCommand(
        basePort + 1,
        { retryStrategy: () => (attempts++ === 0 ? 50 : null) }
      );

      await waitFor(() => redis.status === "end", "the client to end");
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(pending.settlement).to.equal("rejected: Connection is closed.");

      await server.disconnectPromise();
    });

    it("rejects them once maxRetriesPerRequest is reached", async () => {
      // Here the client keeps retrying, so the stash is settled by the
      // maxRetriesPerRequest flush rather than by the connection ending.
      const server = serverReadyOnce(basePort + 2, (socket) =>
        socket.destroy()
      );
      const { redis, pending } = await readyClientWithInFlightCommand(
        basePort + 2,
        { maxRetriesPerRequest: 1 }
      );

      await waitFor(
        () => pending.settlement !== "pending",
        "the stashed command to settle"
      );

      expect(pending.settlement).to.equal(
        "rejected: Reached the max retries per request limit (which is 1). " +
          'Refer to "maxRetriesPerRequest" option for details.'
      );

      redis.disconnect();
      await server.disconnectPromise();
    });

    it("(control) still resends them when the reconnect succeeds", async () => {
      // The stash must only be settled by the flush path when the ready
      // handler can no longer claim it, so a plain successful reconnect keeps
      // resending. Passes with and without the fix.
      let connections = 0;
      const server = new MockServer(basePort + 3, (argv, socket, flags) => {
        const name = String(argv[0]).toLowerCase();
        if (name === "info") {
          return "# Server\r\nredis_version:7.0.0\r\n";
        }
        if (name === "get") {
          if (connections < 2) {
            flags.hang = true;
            return;
          }
          return "bar";
        }
        return "OK";
      });
      server.on("connect", () => connections++);

      const redis = new Redis({
        port: basePort + 3,
        protocol,
        lazyConnect: true,
        retryStrategy: () => 50,
      });
      redis.on("error", () => {});
      await redis.connect();

      const pending = track(redis.get("foo") as Promise<unknown>);
      await waitFor(() => redis.commandQueue.length > 0, "GET to be in flight");
      redis.stream.destroy();

      await waitFor(
        () => pending.settlement !== "pending",
        "the resent command to settle"
      );

      expect(pending.settlement).to.equal("resolved: bar");

      redis.disconnect();
      await server.disconnectPromise();
    });
  });
});
