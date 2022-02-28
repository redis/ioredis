import Redis from "../../lib/Redis";
import { noop } from "../../lib/utils";
import * as sinon from "sinon";
import { expect } from "chai";

const stubInfo = (
  redis: Redis,
  response: [Error | null, string | undefined]
) => {
  sinon.stub(redis, "info").callsFake((section, callback) => {
    const cb = typeof section === "function" ? section : callback;
    const [error, info] = response;
    cb(error, info);
    return error ? Promise.reject(error) : Promise.resolve(info);
  });
};

describe("ready_check", () => {
  it("should retry when redis is not ready", (done) => {
    const redis = new Redis({ lazyConnect: true });

    stubInfo(redis, [null, "loading:1\r\nloading_eta_seconds:7"]);

    // @ts-expect-error
    sinon.stub(global, "setTimeout").callsFake((_body, ms) => {
      if (ms === 7000) {
        done();
      }
    });
    redis.connect().catch(noop);
  });

  it("should reconnect when info return a error", (done) => {
    const redis = new Redis({
      lazyConnect: true,
      retryStrategy: () => {
        done();
        return;
      },
    });

    stubInfo(redis, [new Error("info error"), undefined]);

    redis.connect().catch(noop);
  });

  it("warns for NOPERM error", async () => {
    const redis = new Redis({
      lazyConnect: true,
    });

    const warn = sinon.stub(console, "warn");
    stubInfo(redis, [
      new Error(
        "NOPERM this user has no permissions to run the 'info' command"
      ),
      undefined,
    ]);

    await redis.connect();
    expect(warn.calledOnce).to.eql(true);
  });
});
