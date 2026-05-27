import { expect } from "chai";
import { getFirstValueInFlattenedArray, getFirstKeyForCommand } from "../../lib/autoPipelining";

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

  it("should convert Uint8Array to Buffer in getFirstValueInFlattenedArray", function () {
    const u8 = new Uint8Array([102, 111, 111]); // 'foo'
    const result = getFirstValueInFlattenedArray([u8]);
    expect(result).to.be.instanceof(Buffer);
    expect((result as Buffer).toString()).to.eql("foo");

    const nestedResult = getFirstValueInFlattenedArray([[u8]]);
    expect(nestedResult).to.be.instanceof(Buffer);
    expect((nestedResult as Buffer).toString()).to.eql("foo");
  });

  it("should convert Uint8Array to Buffer in getFirstKeyForCommand", function () {
    const u8 = new Uint8Array([102, 111, 111]); // 'foo'
    // MGET key1 key2
    const result = getFirstKeyForCommand("mget", [[u8, "bar"]]);
    expect(result).to.be.instanceof(Buffer);
    expect((result as Buffer).toString()).to.eql("foo");
  });
});
