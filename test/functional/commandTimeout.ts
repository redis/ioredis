import { expect } from "chai";
import * as net from "net";
import * as sinon from "sinon";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

describe("commandTimeout", () => {
  it("rejects if command timed out", (done) => {
    const server = new MockServer(30001, (argv, socket, flags) => {
      if (argv[0] === "hget") {
        flags.hang = true;
        return;
      }
    });

    const redis = new Redis({ port: 30001, commandTimeout: 1000 });
    const clock = sinon.useFakeTimers();
    redis.hget("foo", (err) => {
      expect(err.message).to.eql("Command timed out");
      clock.restore();
      redis.disconnect();
      server.disconnect(() => done());
    });
    clock.tick(1000);
  });

  it("does not leak timers for commands in offline queue", async () => {
    const server = new MockServer(30001);

    const redis = new Redis({ port: 30001, commandTimeout: 1000 });
    const clock = sinon.useFakeTimers();
    await redis.hget("foo");
    expect(clock.countTimers()).to.eql(0);
    clock.restore();
    redis.disconnect();
    await server.disconnectPromise();
  });

  it("does not replay a timed-out command from the offline queue", async () => {
    const writes: string[] = [];
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("data", (data) => {
        writes.push(data.toString());
        socket.write("+OK\r\n");
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const { port } = server.address() as net.AddressInfo;

    class DelayedConnector {
      private stream?: net.Socket;

      check() {
        return true;
      }

      disconnect() {
        this.stream?.destroy();
      }

      connect() {
        return new Promise<net.Socket>((resolve) => {
          setTimeout(() => {
            const stream = net.createConnection({ port, host: "127.0.0.1" });
            this.stream = stream;
            stream.once("connect", () => resolve(stream));
          }, 50);
        });
      }
    }

    const redis = new Redis({
      Connector: DelayedConnector,
      lazyConnect: true,
      commandTimeout: 20,
      enableReadyCheck: false,
      disableClientInfo: true,
      retryStrategy: null,
    });

    try {
      let error: Error | undefined;
      await redis.set("side-effect-key", "value").catch((err) => {
        error = err;
      });
      expect(error?.message).to.eql("Command timed out");

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(writes).to.eql([]);
    } finally {
      redis.disconnect();
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
