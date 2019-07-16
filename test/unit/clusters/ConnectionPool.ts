import * as sinon from "sinon";
import { expect } from "chai";
import ConnectionPool from "../../../lib/cluster/ConnectionPool";

describe("ConnectionPool", () => {
  describe("#reset", () => {
    it("prefers to master if there are two same node for a slot", () => {
      const pool = new ConnectionPool({});
      const stub = sinon.stub(pool, "findOrCreate");

      pool.reset([
        { host: "127.0.0.1", port: 30001, readOnly: true },
        { host: "127.0.0.1", port: 30001, readOnly: false }
      ]);

      expect(stub.callCount).to.eql(1);
      expect(stub.firstCall.args[1]).to.eql(false);

      pool.reset([
        { host: "127.0.0.1", port: 30001, readOnly: false },
        { host: "127.0.0.1", port: 30001, readOnly: true }
      ]);

      expect(stub.callCount).to.eql(2);
      expect(stub.firstCall.args[1]).to.eql(false);
    });
  });
});
