import Redis from "../../lib/Redis";
import { expect } from "chai";
import * as sinon from "sinon";
import { Cluster } from "../../lib";
import Pipeline from "../../lib/Pipeline";

describe("lazy connect", () => {
  it("should not call `connect` when init", () => {
    // TODO: use spy
    const stub = sinon
      .stub(Redis.prototype, "connect")
      .throws(new Error("`connect` should not be called"));
    new Redis({ lazyConnect: true });

    stub.restore();
  });

  it("should connect when calling a command", (done) => {
    const redis = new Redis({ lazyConnect: true });
    redis.set("foo", "bar");
    redis.get("foo", function (err, result) {
      expect(result).to.eql("bar");
      done();
    });
  });

  it("should not try to reconnect when disconnected manually", (done) => {
    const redis = new Redis({ lazyConnect: true });
    redis.get("foo", () => {
      redis.disconnect();
      redis.get("foo", function (err) {
        expect(err.message).to.match(/Connection is closed/);
        done();
      });
    });
  });

  it("should be able to disconnect", (done) => {
    const redis = new Redis({ lazyConnect: true });
    redis.on("end", () => {
      done();
    });
    redis.disconnect();
  });

  describe("Cluster", () => {
    it("should not call `connect` when init", () => {
      const stub = sinon
        .stub(Cluster.prototype, "connect")
        .throws(new Error("`connect` should not be called"));
      new Cluster([], { lazyConnect: true });
      stub.restore();
    });

    it("should call connect when pipeline exec", (done) => {
      const stub = sinon.stub(Cluster.prototype, "connect").callsFake(() => {
        stub.restore();
        done();
      });
      const cluster = new Cluster([], { lazyConnect: true });
      const pipline = new Pipeline(cluster);
      pipline.get("fool1").exec(() => {});
    });

    it("should call connect when transction exec", (done) => {
      const stub = sinon.stub(Cluster.prototype, "connect").callsFake(() => {
        stub.restore();
        done();
      });
      const cluster = new Cluster([], { lazyConnect: true });
      cluster
        .multi()
        .get("fool1")
        .exec(() => {});
    });

    it('should quit before "close" being emited', (done) => {
      const stub = sinon
        .stub(Cluster.prototype, "connect")
        .throws(new Error("`connect` should not be called"));
      const cluster = new Cluster([], { lazyConnect: true });
      cluster.quit(() => {
        cluster.once("close", () => {
          cluster.once("end", () => {
            stub.restore();
            done();
          });
        });
      });
    });

    it('should disconnect before "close" being emited', (done) => {
      const stub = sinon
        .stub(Cluster.prototype, "connect")
        .throws(new Error("`connect` should not be called"));
      const cluster = new Cluster([], { lazyConnect: true });
      cluster.disconnect();
      cluster.once("close", () => {
        cluster.once("end", () => {
          stub.restore();
          done();
        });
      });
    });

    it("should support disconnecting with reconnect", (done) => {
      let stub = sinon
        .stub(Cluster.prototype, "connect")
        .throws(new Error("`connect` should not be called"));
      const cluster = new Cluster([], {
        lazyConnect: true,
        clusterRetryStrategy: () => {
          return 1;
        },
      });
      cluster.disconnect(true);
      cluster.once("close", () => {
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
