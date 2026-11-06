import { expect } from "chai";
import ensureRestElementsLast = require("../../bin/restElement");

describe("rest element tuple normalization", () => {
  it("keeps a trailing callback required after the variadic elements", () => {
    const source =
      "del(...args: [...keys: (RedisKey)[], callback: Callback<number>]): Result<number, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(
      "del<Rest extends (RedisKey)[]>(...args: [...keys: [...Rest, Callback<number>]]): Result<number, Context>;"
    );
  });

  it("keeps suffix option tokens required and in their original order", () => {
    const source =
      "blmpop(...args: [timeout: number | string, numkeys: number | string, ...keys: (RedisKey)[], left: 'LEFT', callback: Callback<string | null>]): Result<string | null, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(
      "blmpop<Rest extends (RedisKey)[]>(...args: [timeout: number | string, numkeys: number | string, ...keys: [...Rest, 'LEFT', Callback<string | null>]]): Result<string | null, Context>;"
    );
  });

  it("does not absorb a literal suffix into the rest element", () => {
    const source =
      "zdiff(...args: [numkeys: number | string, ...keys: (RedisKey)[], withscores: 'WITHSCORES']): Result<Scored, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(
      "zdiff<Rest extends (RedisKey)[]>(...args: [numkeys: number | string, ...keys: [...Rest, 'WITHSCORES']]): Result<Scored, Context>;"
    );
    expect(ensureRestElementsLast(source)).to.not.contain(
      "RedisKey | 'WITHSCORES'"
    );
  });

  it("keeps a generic rest tuple inferable when appending a callback", () => {
    const source =
      "vsim<T extends RedisValue[]>(...args: [key: RedisKey, ...args: T, callback: Callback<VsimReply<T, string, Context>>]): Result<VsimReply<T, string, Context>, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(
      "vsim<T extends RedisValue[]>(...args: [key: RedisKey, ...args: [...T, Callback<VsimReply<T, string, Context>>]]): Result<VsimReply<T, string, Context>, Context>;"
    );
  });

  it("preserves nested tuples inside the callback type", () => {
    const source =
      "argrep(...args: [key: RedisKey, ...args: RedisValue[], callback: Callback<number[] | Array<[index: number, value: string]>>]): Result<number[], Context>;";
    expect(ensureRestElementsLast(source)).to.equal(
      "argrep<Rest extends RedisValue[]>(...args: [key: RedisKey, ...args: [...Rest, Callback<number[] | Array<[index: number, value: string]>>]]): Result<number[], Context>;"
    );
  });

  it("adds another rest parameter when the signature already has one", () => {
    const source =
      "foo<T extends string>(...args: [head: T, ...tail: (string)[], callback: Callback<T>]): Result<T, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(
      "foo<T extends string, Rest extends (string)[]>(...args: [head: T, ...tail: [...Rest, Callback<T>]]): Result<T, Context>;"
    );
  });

  it("leaves tuples whose rest element is already last untouched", () => {
    const source =
      "del(...args: [...keys: (RedisKey)[]]): Result<number, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(source);
  });

  it("leaves an already rewritten generic suffix tuple untouched", () => {
    const source =
      "vsim<T extends RedisValue[]>(...args: [key: RedisKey, ...args: [...T, Callback<VsimReply<T, string, Context>>]]): Result<VsimReply<T, string, Context>, Context>;";
    expect(ensureRestElementsLast(source)).to.equal(source);
  });

  it("keeps the callback overload ahead of the promise overload", () => {
    const source = [
      "zadd(...args: [key: RedisKey, ...data: (string | number)[], callback: Callback<number>]): Result<number, Context>;",
      "zadd(...args: [key: RedisKey, ...data: (string | number)[]]): Result<number, Context>;",
    ].join("\n");
    expect(ensureRestElementsLast(source)).to.equal(
      [
        "zadd<Rest extends (string | number)[]>(...args: [key: RedisKey, ...data: [...Rest, Callback<number>]]): Result<number, Context>;",
        "zadd(...args: [key: RedisKey, ...data: (string | number)[]]): Result<number, Context>;",
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
    expect(normalized).to.contain(
      "acl<Rest extends (string | Buffer)[]>(...args: [subcommand: 'DELUSER', ...usernames: [...Rest, Callback<number>]]): Result<number, Context>;"
    );
  });

  it("is idempotent", () => {
    const source =
      "call(...args: [command: string, ...args: (string | Buffer | number)[], callback: Callback<unknown>]): Result<unknown, Context>;";
    const once = ensureRestElementsLast(source);
    expect(once).to.equal(
      "call<Rest extends (string | Buffer | number)[]>(...args: [command: string, ...args: [...Rest, Callback<unknown>]]): Result<unknown, Context>;"
    );
    expect(ensureRestElementsLast(once)).to.equal(once);
  });
});
