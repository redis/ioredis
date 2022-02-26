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
