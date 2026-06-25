import MockServer from "../helpers/mock_server";
import { expect } from "chai";
import Redis from "../../lib/Redis";

const PORT = 30001;

describe("protocol downgrade", () => {
  it("downgrades to RESP2 when the server doesn't support HELLO", (done) => {
    const commands: string[][] = [];
    new MockServer(PORT, (argv) => {
      commands.push(argv);
      if (argv[0] === "hello") {
        return new Error("ERR unknown command 'HELLO'");
      }
      if (argv[0] === "get") {
        return "bar";
      }
    });

    const redis = new Redis({ port: PORT, protocol: 3 });
    redis.on("ready", async () => {
      // HELLO 3 was attempted, and the connection recovered into a usable
      // state instead of looping on the rejected handshake.
      expect(commands.some((c) => c[0] === "hello")).to.eql(true);
      expect(await redis.get("foo")).to.eql("bar");
      redis.disconnect();
      done();
    });
  });

  it("downgrades to RESP2 on a NOPROTO error", (done) => {
    new MockServer(PORT, (argv) => {
      if (argv[0] === "hello") {
        return new Error("NOPROTO unsupported protocol version");
      }
      if (argv[0] === "get") {
        return "bar";
      }
    });

    const redis = new Redis({ port: PORT, protocol: 3 });
    redis.on("ready", async () => {
      expect(await redis.get("foo")).to.eql("bar");
      redis.disconnect();
      done();
    });
  });

  it("re-sends AUTH after downgrading when a password is set", (done) => {
    let helloSeen = false;
    let authedAfterHello = false;
    new MockServer(PORT, (argv) => {
      if (argv[0] === "hello") {
        helloSeen = true;
        return new Error("ERR unknown command 'HELLO'");
      }
      if (argv[0] === "auth") {
        // The bundled AUTH died with the failed HELLO, so a plain AUTH must be
        // sent on the RESP2 retry.
        expect(helloSeen).to.eql(true);
        authedAfterHello = true;
        return MockServer.REDIS_OK;
      }
      if (argv[0] === "get") {
        expect(authedAfterHello).to.eql(true);
        return "bar";
      }
    });

    const redis = new Redis({ port: PORT, protocol: 3, password: "pass" });
    redis.on("ready", async () => {
      expect(await redis.get("foo")).to.eql("bar");
      redis.disconnect();
      done();
    });
  });

  it("routes pub/sub as RESP2 after downgrading", (done) => {
    let server: MockServer;
    server = new MockServer(PORT, (argv, socket) => {
      if (argv[0] === "hello") {
        return new Error("ERR unknown command 'HELLO'");
      }
      if (argv[0] === "subscribe") {
        // Push a RESP2-style inline message once subscribed. A connection still
        // in RESP3 mode would expect a push frame and mishandle this, so the
        // delivered "message" event proves the parser downgraded too.
        setImmediate(() => server.write(socket, ["message", argv[1], "hello"]));
        return ["subscribe", argv[1], 1];
      }
    });

    const redis = new Redis({ port: PORT, protocol: 3 });
    redis.on("message", (channel, message) => {
      expect(channel).to.eql("news");
      expect(message).to.eql("hello");
      redis.disconnect();
      done();
    });
    redis.subscribe("news");
  });

  it("stays on RESP3 when the server supports HELLO", (done) => {
    let helloCount = 0;
    new MockServer(PORT, (argv) => {
      if (argv[0] === "hello") {
        helloCount += 1;
        return MockServer.REDIS_OK;
      }
      if (argv[0] === "get") {
        return "bar";
      }
    });

    const redis = new Redis({ port: PORT, protocol: 3 });
    redis.on("ready", async () => {
      // HELLO succeeded once and was never retried, i.e. no spurious downgrade.
      expect(helloCount).to.eql(1);
      expect(await redis.get("foo")).to.eql("bar");
      redis.disconnect();
      done();
    });
  });
});
