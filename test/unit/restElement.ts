import { expect } from "chai";
import ensureRestElementsLast = require("../../bin/restElement");

describe("rest element tuple normalization", () => {
  it("folds a trailing callback into the rest element", () => {
    const source =
      "del(...args: [...keys: (RedisKey)[], callback: Callback<number>]): Result<number, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(
      "del(...args: [...keys: (RedisKey | Callback<number>)[]]): Result<number, Context>;"
    );
  });

  it("keeps suffix option tokens assignable in their original order", () => {
    const source =
      "blmpop(...args: [timeout: number | string, numkeys: number | string, ...keys: (RedisKey)[], left: 'LEFT', callback: Callback<string | null>]): Result<string | null, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(
      "blmpop(...args: [timeout: number | string, numkeys: number | string, ...keys: (RedisKey | 'LEFT' | Callback<string | null>)[]]): Result<string | null, Context>;"
    );
  });

  it("expands a generic rest element before appending the callback", () => {
    const source =
      "vsim<T extends RedisValue[]>(...args: [key: RedisKey, ...args: T, callback: Callback<VsimReply<T, string, Context>>]): Result<VsimReply<T, string, Context>, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(
      "vsim<T extends RedisValue[]>(...args: [key: RedisKey, ...args: (T[number] | Callback<VsimReply<T, string, Context>>)[]]): Result<VsimReply<T, string, Context>, Context>;"
    );
  });

  it("preserves nested tuples inside the callback type", () => {
    const source =
      "argrep(...args: [key: RedisKey, ...args: RedisValue[], callback: Callback<number[] | Array<[index: number, value: string]>>]): Result<number[], Context>;";
    expect(ensureRestElementsLast(source)).to.equal(
      "argrep(...args: [key: RedisKey, ...args: (RedisValue | Callback<number[] | Array<[index: number, value: string]>>)[]]): Result<number[], Context>;"
    );
  });

  it("leaves tuples whose rest element is already last untouched", () => {
    const source =
      "del(...args: [...keys: (RedisKey)[]]): Result<number, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(source);
  });

  it("lists precise rest overloads before folded callback overloads", () => {
    const source = [
      "zadd(...args: [key: RedisKey, ...data: (string | number)[], callback: Callback<number>]): Result<number, Context>;",
      "zadd(...args: [key: RedisKey, ...data: (string | number)[]]): Result<number, Context>;",
    ].join("\n");
    expect(ensureRestElementsLast(source)).to.equal(
      [
        "zadd(...args: [key: RedisKey, ...data: (string | number)[]]): Result<number, Context>;",
        "zadd(...args: [key: RedisKey, ...data: (string | number | Callback<number>)[]]): Result<number, Context>;",
      ].join("\n")
    );
  });

  it("does not move overloads across documented command blocks", () => {
    const source = [
      "  /**",
      "   * Deletes users.",
      "   */",
      "  acl(...args: [subcommand: 'DELUSER', ...usernames: (string | Buffer)[], callback: Callback<number>]): Result<number, Context>;",
      "  acl(...args: [subcommand: 'DELUSER', ...usernames: (string | Buffer)[]]): Result<number, Context>;",
      "",
      "  /**",
      "   * Generates a password.",
      "   */",
      "  acl(subcommand: 'GENPASS', callback?: Callback<string>): Result<string, Context>;",
    ].join("\n");
    const normalized = ensureRestElementsLast(source);
    expect(normalized.indexOf("DELUSER")).to.be.lessThan(
      normalized.indexOf("Generates a password")
    );
    expect(normalized.indexOf("GENPASS")).to.be.greaterThan(
      normalized.indexOf("Generates a password")
    );
    expect(normalized).to.contain(
      "acl(...args: [subcommand: 'DELUSER', ...usernames: (string | Buffer)[]]): Result<number, Context>;"
    );
  });

  it("is idempotent", () => {
    const source =
      "call(...args: [command: string, ...args: (string | Buffer | number)[], callback: Callback<unknown>]): Result<unknown, Context>;";
    const once = ensureRestElementsLast(source);
    expect(ensureRestElementsLast(once)).to.equal(once);
  });
});
