import { expect } from "chai";
import {
  flattenNestedArrayItems,
  passthroughReplyTransformer,
  ReplyTransformerContext,
  transformStreamReadReply,
  wrapStreamMapPairs,
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

  describe(".wrapStreamMapPairs", () => {
    it("returns non-array replies unchanged", () => {
      const reply = null;

      expect(wrapStreamMapPairs(reply, context)).to.equal(reply);
    });

    it("wraps flattened stream map pairs", () => {
      expect(
        wrapStreamMapPairs(
          ["stream-a", [["1-1", ["field", "value"]]], "stream-b", []],
          context
        )
      ).to.eql([
        ["stream-a", [["1-1", ["field", "value"]]]],
        ["stream-b", []],
      ]);
    });
  });

  describe(".transformStreamReadReply", () => {
    it("wraps RESP3 legacy stream map replies", () => {
      expect(
        transformStreamReadReply(["stream-a", [["1-1", ["field", "value"]]]], {
          ...context,
          protocol: 3,
          replyMapping: "legacy",
        })
      ).to.eql([["stream-a", [["1-1", ["field", "value"]]]]]);
    });

    it("leaves RESP2 replies unchanged", () => {
      const reply = [["stream-a", [["1-1", ["field", "value"]]]]];

      expect(
        transformStreamReadReply(reply, {
          ...context,
          protocol: 2,
          replyMapping: "legacy",
        })
      ).to.equal(reply);
    });

    it("leaves native RESP3 replies unchanged", () => {
      const reply = { "stream-a": [["1-1", ["field", "value"]]] };

      expect(
        transformStreamReadReply(reply, {
          ...context,
          protocol: 3,
          replyMapping: "resp3",
        })
      ).to.equal(reply);
    });
  });
});
