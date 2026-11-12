import { expect } from "chai";
import * as sinon from "sinon";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

describe("commandTimeout", () => {
  it("rejects if a written command timed out", (done) => {
    const server = new MockServer(30001, (argv, _socket, flags) => {
      if (argv[0] === "hget") {
        flags.hang = true;
        return;
      }
    });

    const redis = new Redis({ port: 30001, commandTimeout: 1000 });
    redis.once("ready", () => {
      const clock = sinon.useFakeTimers();
      redis.hget("foo", (err) => {
        try {
          expect(err.message).to.eql("Command timed out");
        } finally {
          clock.restore();
          redis.disconnect();
          server.disconnect(() => done());
        }
      });
      clock.tick(1000);
    });
  });

  it("does not leak timers after a command completes", async () => {
    const server = new MockServer(30001);

    const redis = new Redis({ port: 30001, commandTimeout: 1000 });
    await redis.hget("foo");
    const clock = sinon.useFakeTimers();
    expect(clock.countTimers()).to.eql(0);
    clock.restore();
    redis.disconnect();
    await server.disconnectPromise();
  });
});
