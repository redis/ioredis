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
