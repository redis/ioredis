import rDebug = require("debug");
import * as sinon from "sinon";
import { expect } from "chai";
import debug, {
  getStringValue,
  MAX_ARGUMENT_LENGTH,
} from "../../lib/utils/debug";

describe("utils/debug", function () {
  afterEach(function () {
    rDebug.enable(process.env.DEBUG || "");
  });

  describe(".exports.getStringValue", function () {
    it("should return a string or undefined", function () {
      expect(getStringValue(true)).to.be.undefined;
      expect(getStringValue(undefined)).to.be.undefined;
      expect(getStringValue(null)).to.be.undefined;
      expect(getStringValue(false)).to.be.undefined;
      expect(getStringValue(1)).to.be.undefined;
      expect(getStringValue(1.1)).to.be.undefined;
      expect(getStringValue(-1)).to.be.undefined;
      expect(getStringValue(-1.1)).to.be.undefined;

      expect(getStringValue("abc")).to.be.a("string");
      expect(
        getStringValue(Buffer.from ? Buffer.from("abc") : Buffer.from("abc"))
      ).to.be.a("string");
      expect(getStringValue(new Date())).to.be.a("string");
      expect(getStringValue({ foo: { bar: "qux" } })).to.be.a("string");
    });
  });

  describe(".exports", function () {
    it("should return a function", function () {
      expect(debug("test")).to.be.a("function");
    });

    it("should output to console if DEBUG is set", function () {
      const dbgNS = "ioredis:debugtest";

      rDebug.enable(dbgNS);

      const logspy = sinon.spy();
      const fn = debug("debugtest");

      // @ts-expect-error
      fn.log = logspy;

      // @ts-expect-error
      expect(fn.enabled).to.equal(true);
      // @ts-expect-error
      expect(fn.namespace).to.equal(dbgNS);

      let data = [],
        i = 0;

      while (i < 1000) {
        data.push(String(i));
        i += 1;
      }

      const datastr = JSON.stringify(data);

      fn("my message %s", { json: data });
      expect(logspy.called).to.equal(true);

      const args = logspy.getCall(0).args;

      const wantedArglen =
        30 + // " ... <REDACTED full-length="">"
        MAX_ARGUMENT_LENGTH + // max-length of redacted string
        datastr.length.toString().length; // length of string of string length (inception much?)

      expect(args.length).to.be.above(1);
      expect(args[1]).to.be.a("string");
      expect(args[1].length).to.equal(wantedArglen);
    });
  });
});
