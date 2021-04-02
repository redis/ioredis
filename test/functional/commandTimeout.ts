import { expect } from "chai";
import * as sinon from "sinon";
import Redis from "../../lib/redis";
import MockServer from "../helpers/mock_server";

describe("commandTimeout", function () {
  it("rejects if command timed out", function (done) {
    const server = new MockServer(30001, function (argv, socket, flags) {
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
});
