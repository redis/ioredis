import Redis from "../../lib/Redis";
import { expect } from "chai";
import MockServer from "../helpers/mock_server";

describe("fatal_error", () => {
  it("should handle fatal error of parser", (done) => {
    let recovered = false;
    new MockServer(30000, (argv) => {
      if (recovered) {
        return;
      }
      if (argv[0] === "get") {
        return MockServer.raw("&\r\n");
      }
    });
    const redis = new Redis(30000);
    redis.get("foo", function (err) {
      expect(err.message).to.match(/Unknown RESP type/);

      recovered = true;
      redis.get("bar", function (err) {
        expect(err).to.eql(null);
        done();
      });
    });
  });

  it("should not pass a truncated reply on to the next command", async () => {
    let calls = 0;
    new MockServer(30000, (argv) => {
      if (argv[0] === "get") {
        calls += 1;
        // The first reply is followed by a truncated "$1\r\n".
        return MockServer.raw(
          calls === 1 ? `$1\r\n${argv[1]}\r\n$1\r\n` : `$1\r\n${argv[1]}\r\n`
        );
      }
    });
    const redis = new Redis(30000);
    redis.on("error", () => {});

    expect(await redis.get("a")).to.eql("a");
    let error: Error | undefined;
    try {
      await redis.get("b");
    } catch (err) {
      error = err;
    }
    expect(error && error.message).to.match(/Expected CRLF/);
    expect(await redis.get("c")).to.eql("c");
    redis.disconnect();
  });
});
