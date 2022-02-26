import Redis from "../../lib/Redis";
import { noop } from "../../lib/utils";
import * as sinon from "sinon";

describe("ready_check", () => {
  it("should retry when redis is not ready", (done) => {
    const redis = new Redis({ lazyConnect: true });

    sinon.stub(redis, "info").callsFake((callback) => {
      callback(null, "loading:1\r\nloading_eta_seconds:7");
    });
    // @ts-expect-error
    const stub = sinon.stub(global, "setTimeout").callsFake((body, ms) => {
      if (ms === 7000) {
        redis.info.restore();
        stub.restore();
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

    sinon.stub(redis, "info").callsFake((callback) => {
      callback(new Error("info error"));
    });

    redis.connect().catch(noop);
  });
});
