import Redis from "../../lib/redis";
import { expect } from "chai";
import * as sinon from "sinon";
import { Cluster } from "../../lib";

describe("lazy connect", function () {
  it("should not call `connect` when init", function () {
    // TODO: use spy
    const stub = sinon
      .stub(Redis.prototype, "connect")
      .throws(new Error("`connect` should not be called"));
    new Redis({ lazyConnect: true });

    stub.restore();
  });

  it("should connect when calling a command", function (done) {
    const redis = new Redis({ lazyConnect: true });
    redis.set("foo", "bar");
    redis.get("foo", function (err, result) {
      expect(result).to.eql("bar");
      done();
    });
  });

  it("should not try to reconnect when disconnected manually", function (done) {
    const redis = new Redis({ lazyConnect: true });
    redis.get("foo", function () {
      redis.disconnect();
      redis.get("foo", function (err) {
        expect(err.message).to.match(/Connection is closed/);
        done();
      });
    });
  });

  it("should be able to disconnect", function (done) {
    const redis = new Redis({ lazyConnect: true });
    redis.on("end", function () {
      done();
    });
    redis.disconnect();
  });

  describe("Cluster", function () {
    it("should not call `connect` when init", function () {
      const stub = sinon
        .stub(Cluster.prototype, "connect")
        .throws(new Error("`connect` should not be called"));
      new Cluster([], { lazyConnect: true });
      stub.restore();
    });

    it('should quit before "close" being emited', function (done) {
      const stub = sinon
        .stub(Cluster.prototype, "connect")
        .throws(new Error("`connect` should not be called"));
      const cluster = new Cluster([], { lazyConnect: true });
      cluster.quit(function () {
        cluster.once("close", function () {
          cluster.once("end", function () {
            stub.restore();
            done();
          });
        });
      });
    });

    it('should disconnect before "close" being emited', function (done) {
      const stub = sinon
        .stub(Cluster.prototype, "connect")
        .throws(new Error("`connect` should not be called"));
      const cluster = new Cluster([], { lazyConnect: true });
      cluster.disconnect();
      cluster.once("close", function () {
        cluster.once("end", function () {
          stub.restore();
          done();
        });
      });
    });

    it("should support disconnecting with reconnect", function (done) {
      let stub = sinon
        .stub(Cluster.prototype, "connect")
        .throws(new Error("`connect` should not be called"));
      const cluster = new Cluster([], {
        lazyConnect: true,
        clusterRetryStrategy: function () {
          return 1;
        },
      });
      cluster.disconnect(true);
      cluster.once("close", function () {
        stub.restore();
        stub = sinon.stub(Cluster.prototype, "connect").callsFake(() => {
          stub.restore();
          done();
          return Promise.resolve();
        });
      });
    });
  });
});
