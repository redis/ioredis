import * as sinon from "sinon";
import { expect } from "chai";
import { print } from "../../lib";

describe("index", () => {
  describe("print()", () => {
    it("prints logs", () => {
      const stub = sinon.stub(console, "log");
      print(new Error("err"));
      print(null, "success");
      expect(stub.calledTwice).to.eql(true);
      stub.restore();
    });
  });
});
