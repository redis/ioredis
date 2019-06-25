import * as sinon from "sinon";
import { expect } from "chai";
import { print } from "../../lib";

describe("index", function() {
  describe("print()", function() {
    it("prints logs", function() {
      const stub = sinon.stub(console, "log");
      print(new Error("err"));
      print(null, "success");
      expect(stub.calledTwice).to.eql(true);
      stub.restore();
    });
  });
});
