import * as chai from "chai";
import type { Socket } from "net";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

const { expect } = chai;

describe("blocking command reconnect (#1285)", function () {
  const PORT = 30001;
  this.timeout(30000);

  it("resends brpoplpush after aggressive retryStrategy reconnect drops", (done) => {
    let connections = 0;
    let brpoplpushAttempts = 0;

    const server = new MockServer(PORT, (argv, _socket, flags) => {
      if (argv[0] === "brpoplpush") {
        brpoplpushAttempts += 1;
        if (brpoplpushAttempts < 3) {
          flags.hang = true;
          return;
        }
        return null;
      }
    });

    server.on("connect", (socket: Socket) => {
      connections += 1;
      if (connections === 2) {
        setTimeout(() => socket.destroy(), 10);
      }
    });

    const redis = new Redis({
      port: PORT,
      retryStrategy: (times) => Math.min(Math.exp(times), 200),
      maxRetriesPerRequest: null,
    });
    redis.on("error", () => {});

    redis.once("ready", () => {
      redis
        .brpoplpush(`src:${Date.now()}`, `dst:${Date.now()}`, 4)
        .then((res) => {
          expect(res).to.eql(null);
          expect(brpoplpushAttempts).to.be.at.least(3);
          redis.disconnect();
          server.disconnect(() => done());
        })
        .catch(done);

      setTimeout(() => redis.stream.destroy(), 50);
    });
  });
});
