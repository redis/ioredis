import { describe, expect, it } from "@jest/globals";
import Redis from "../../lib/Redis";

const path = require("path");
const scriptName = path.basename(__filename);

describe("showFriendlyErrorStack", () => {
  it("should show friendly error stack", (done) => {
    const redis = new Redis({ showFriendlyErrorStack: true });
    // @ts-expect-error
    redis.set("foo").catch(function (err) {
      const errors = err.stack.split("\n");
      expect(errors[0].indexOf("ReplyError")).not.toBe(-1);
      expect(errors[1].indexOf(scriptName)).not.toBe(-1);
      done();
    });
  });
});
