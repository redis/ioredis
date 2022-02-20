import { expect } from "chai";
import { getFirstValueInFlattenedArray } from "../../lib/autoPipelining";

describe("autoPipelining", function () {
  const expectGetFirstValueIs = (values, expected) => {
    expect(getFirstValueInFlattenedArray(values)).to.eql(expected);
  };

  it("should be able to efficiently get array args", function () {
    expectGetFirstValueIs([], undefined);
    expectGetFirstValueIs([null, "key"], null);
    expectGetFirstValueIs(["key", "value"], "key");
    expectGetFirstValueIs([[], "key"], "key");
    expectGetFirstValueIs([["key"]], "key");
    expectGetFirstValueIs([[["key"]]], ["key"]);
    expectGetFirstValueIs([0, 1, 2, 3, 4], 0);
    expectGetFirstValueIs([[true]], true);
    expectGetFirstValueIs([Buffer.from("test")], Buffer.from("test"));
    expectGetFirstValueIs([{}], {});
    // lodash.isArguments is true for this legacy js way to get argument lists
    const createArguments = function () {
      return arguments;
    };
    // @ts-expect-error
    expectGetFirstValueIs([createArguments(), createArguments("key")], "key");
    // @ts-expect-error
    expectGetFirstValueIs([createArguments("")], "");
  });
});
