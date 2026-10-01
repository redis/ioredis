import * as sinon from "sinon";
import { expect } from "chai";
import ConnectionPool from "../../../lib/cluster/ConnectionPool";

describe("ConnectionPool", () => {
  describe("clusterNodeRetryStrategy", () => {
    it("sets retryStrategy to null when clusterNodeRetryStrategy is not provided", () => {
      const pool = new ConnectionPool({});
      const redis = pool.findOrCreate({ host: "127.0.0.1", port: 30001 });
      expect(redis.options.retryStrategy).to.be.null;
    });

    it("sets retryStrategy to null when clusterNodeRetryStrategy is null", () => {
      const pool = new ConnectionPool({}, null);
      const redis = pool.findOrCreate({ host: "127.0.0.1", port: 30001 });
      expect(redis.options.retryStrategy).to.be.null;
    });

    it("uses clusterNodeRetryStrategy as retryStrategy when it is a function", () => {
      const strategy = (times: number) => times * 100;
      const pool = new ConnectionPool({}, strategy);
      const redis = pool.findOrCreate({ host: "127.0.0.1", port: 30001 });
      expect(redis.options.retryStrategy).to.equal(strategy);
    });
  });

  describe("nodeError event", () => {
    it("emits nodeError on the pool when a node emits an error", (done) => {
      const pool = new ConnectionPool({});
      const redis = pool.findOrCreate({ host: "127.0.0.1", port: 30001 });

      pool.on("nodeError", (error, key) => {
        expect(error.message).to.eql("test error");
        expect(key).to.eql("127.0.0.1:30001");
        done();
      });

      redis.emit("error", new Error("test error"));
    });
  });

  describe("#recreate", () => {
    it("replaces the existing connection with a new instance", () => {
      const pool = new ConnectionPool({});
      const oldRedis = pool.findOrCreate({ host: "127.0.0.1", port: 30001 });
      const disconnectStub = sinon.stub(oldRedis, "disconnect");

      const newRedis = pool.recreate({ host: "127.0.0.1", port: 30001 });

      expect(disconnectStub.calledOnce).to.eql(true);
      expect(newRedis).to.not.equal(oldRedis);
      expect(pool.getInstanceByKey("127.0.0.1:30001")).to.equal(newRedis);
      expect(pool.getNodes().length).to.eql(1);
    });

    it("emits -node for the old instance and +node for the new one", () => {
      const pool = new ConnectionPool({});
      const oldRedis = pool.findOrCreate({ host: "127.0.0.1", port: 30001 });
      sinon.stub(oldRedis, "disconnect");

      const removed = [];
      const added = [];
      pool.on("-node", (redis, key) => removed.push([redis, key]));
      pool.on("+node", (redis, key) => added.push([redis, key]));

      const newRedis = pool.recreate({ host: "127.0.0.1", port: 30001 });
      oldRedis.emit("end");

      expect(removed).to.eql([[oldRedis, "127.0.0.1:30001"]]);
      expect(added).to.eql([[newRedis, "127.0.0.1:30001"]]);
    });

    it("does not remove the new node when the stale connection ends", () => {
      const pool = new ConnectionPool({});
      const oldRedis = pool.findOrCreate({ host: "127.0.0.1", port: 30001 });
      sinon.stub(oldRedis, "disconnect");

      const newRedis = pool.recreate({ host: "127.0.0.1", port: 30001 });
      oldRedis.emit("end");

      expect(pool.getInstanceByKey("127.0.0.1:30001")).to.equal(newRedis);
      expect(pool.getNodes().length).to.eql(1);
    });

    it("creates the connection when the node is not in the pool", () => {
      const pool = new ConnectionPool({});
      const redis = pool.recreate({ host: "127.0.0.1", port: 30001 });
      expect(pool.getInstanceByKey("127.0.0.1:30001")).to.equal(redis);
    });

    it("still removes the node when the current connection ends", () => {
      const pool = new ConnectionPool({});
      const newRedis = pool.recreate({ host: "127.0.0.1", port: 30001 });

      let drained = false;
      pool.on("drain", () => {
        drained = true;
      });
      newRedis.emit("end");

      expect(pool.getNodes().length).to.eql(0);
      expect(drained).to.eql(true);
    });
  });

  describe("#reset", () => {
    it("prefers to master if there are two same node for a slot", () => {
      const pool = new ConnectionPool({});
      const stub = sinon.stub(pool, "findOrCreate");

      pool.reset([
        { host: "127.0.0.1", port: 30001, readOnly: true },
        { host: "127.0.0.1", port: 30001, readOnly: false },
      ]);

      expect(stub.callCount).to.eql(1);
      expect(stub.firstCall.args[1]).to.eql(false);

      pool.reset([
        { host: "127.0.0.1", port: 30001, readOnly: false },
        { host: "127.0.0.1", port: 30001, readOnly: true },
      ]);

      expect(stub.callCount).to.eql(2);
      expect(stub.firstCall.args[1]).to.eql(false);
    });

    it("remove the node immediately instead of waiting for 'end' event", () => {
      const pool = new ConnectionPool({});
      pool.reset([{ host: "127.0.0.1", port: 300001 }]);
      expect(pool.getNodes().length).to.eql(1);

      pool.reset([]);
      expect(pool.getNodes().length).to.eql(0);
    });
  });
});
