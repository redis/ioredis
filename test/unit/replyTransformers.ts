import { expect } from "chai";
import {
  flattenNestedArrayItems,
  passthroughReplyTransformer,
  ReplyTransformerContext,
} from "../../lib/replyTransformers";

const context: ReplyTransformerContext = {
  commandName: "test",
  protocol: 3,
  replyMapping: "legacy",
};

describe("replyTransformers", () => {
  describe(".passthroughReplyTransformer", () => {
    it("returns the original reply unchanged", () => {
      const reply = [["member", "1"], ["other", "2"]];

      expect(passthroughReplyTransformer(reply, context)).to.equal(reply);
    });
  });

  describe(".flattenNestedArrayItems", () => {
    it("returns non-array replies unchanged", () => {
      const reply = { member: ["1", null] };

      expect(flattenNestedArrayItems(reply, context)).to.equal(reply);
    });

    it("returns arrays without nested items unchanged", () => {
      const reply = ["member", "1", "other", "2"];

      expect(flattenNestedArrayItems(reply, context)).to.equal(reply);
    });

    it("flattens nested array items one level", () => {
      expect(
        flattenNestedArrayItems(
          ["member", ["1", null], "other", ["2", "attr"]],
          context
        )
      ).to.eql(["member", "1", null, "other", "2", "attr"]);
    });
  });
});
