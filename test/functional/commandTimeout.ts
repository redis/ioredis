import { expect } from "chai";
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

  describe("blocking commands", () => {
    const COMMAND_TIMEOUT = 20;
    const REPLY_DELAY = 100;

    // Replies to `name` only after the command timeout has passed.
    const delayedServer = (name: string, reply: string) =>
      new MockServer(30001, (argv, socket, flags) => {
        if (argv[0].toLowerCase() === name) {
          flags.hang = true;
          setTimeout(() => socket.write(reply), REPLY_DELAY);
        }
      });

    const cases: Array<[string, string, (redis: Redis) => Promise<unknown>]> = [
      ["blpop", "blpop with a finite timeout", (r) => r.blpop("queue", 1)],
      ["blpop", "blpop that blocks forever", (r) => r.blpop("queue", 0)],
      ["blpop", "an uppercase BLPOP", (r) => r.call("BLPOP", "queue", 1)],
      [
        "xread",
        "xread with BLOCK",
        (r) => r.xread("BLOCK", 1000, "STREAMS", "stream", "$"),
      ],
    ];

    cases.forEach(([name, description, send]) => {
      it(`does not apply commandTimeout to ${description}`, async () => {
        const server = delayedServer(name, "*-1\r\n");
        const redis = new Redis({
          port: 30001,
          commandTimeout: COMMAND_TIMEOUT,
        });

        try {
          expect(await send(redis)).to.eql(null);
        } finally {
          redis.disconnect();
          await server.disconnectPromise();
        }
      });
    });

    it("still applies commandTimeout to xread without BLOCK", async () => {
      const server = delayedServer("xread", "*-1\r\n");
      const redis = new Redis({ port: 30001, commandTimeout: COMMAND_TIMEOUT });

      try {
        let error: Error | undefined;
        await redis.xread("STREAMS", "stream", "$").catch((err) => {
          error = err;
        });
        expect(error?.message).to.eql("Command timed out");
      } finally {
        redis.disconnect();
        await server.disconnectPromise();
      }
    });

    it("lets blockingTimeout protect a blocking command", async () => {
      const server = new MockServer(30001, (argv, _socket, flags) => {
        if (argv[0] === "blpop") {
          flags.hang = true;
        }
      });
      const redis = new Redis({
        port: 30001,
        commandTimeout: COMMAND_TIMEOUT,
        blockingTimeout: 50,
      });
      redis.on("error", () => {});

      try {
        expect(await redis.blpop("queue", 0)).to.eql(null);
      } finally {
        redis.disconnect();
        await server.disconnectPromise();
      }
    });
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
});
