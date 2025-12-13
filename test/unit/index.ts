import * as sinon from "sinon";
import { expect } from "chai";
import { print, Script } from "../../lib";

describe("index", function () {
  describe("print()", function () {
    it("prints logs", function () {
      const stub = sinon.stub(console, "log");
      print(new Error("err"));
      print(null, "success");
      expect(stub.calledTwice).to.eql(true);
      stub.restore();
    });
  });
  describe("Script", function () {
    it("is exported", function () {
      const script = new Script("return 1;", 1);
      expect(script.sha).to.eql("b639ab24886e7d0cc4a63fe21aee40ba60dcac14");
    });
  });
});
