import Redis from "../../lib/Redis";
import { expect } from "chai";

const path = require("path");
const scriptName = path.basename(__filename);

describe("showFriendlyErrorStack", function () {
  it("should show friendly error stack", function (done) {
    const redis = new Redis({ showFriendlyErrorStack: true });
    redis.set("foo").catch(function (err) {
      const errors = err.stack.split("\n");
      expect(errors[0].indexOf("ReplyError")).not.eql(-1);
      expect(errors[1].indexOf(scriptName)).not.eql(-1);
      done();
    });
  });
});
