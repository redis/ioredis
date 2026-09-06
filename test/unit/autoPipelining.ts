import { expect } from "chai";
import {
  executeWithAutoPipelining,
  getFirstValueInFlattenedArray,
  kCallbacks,
  kExec,
} from "../../lib/autoPipelining";

function createFakeClient(pipelineFactory: () => any) {
  return {
    isCluster: false,
    isPipeline: false,
    options: {
      enableAutoPipelining: true,
      autoPipeliningIgnoredCommands: [],
      keyPrefix: "",
    },
    _autoPipelines: new Map(),
    _runningAutoPipelines: new Set(),
    pipeline: pipelineFactory,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("autoPipelining", function () {
  it("does not misalign or drop later commands when an earlier one fails to queue", async function () {
    const calls: [string, string][] = [];
    const client = createFakeClient(() => {
      const pipeline: any = {
        [kExec]: false,
        [kCallbacks]: [],
        get(key: string) {
          calls.push(["get", key]);
        },
        exec(cb: (err: Error | null, results?: any[]) => void) {
          const results = calls.map(([, key]) => [null, `value:${key}`]);
          process.nextTick(cb, null, results);
        },
      };
      return pipeline;
    });

    const uncaught: Error[] = [];
    const onUncaughtException = (err: Error) => uncaught.push(err);
    process.once("uncaughtException", onUncaughtException);

    const first = executeWithAutoPipelining(client, "get", "get", ["a"], null);
    const middle = executeWithAutoPipelining(
      client,
      "thisMethodDoesNotExist",
      "thisMethodDoesNotExist",
      ["b"],
      null
    );
    const last = executeWithAutoPipelining(client, "get", "get", ["c"], null);
    middle.catch(() => {
      // rejection is expected and asserted on below
    });

    await sleep(20);
    process.removeListener("uncaughtException", onUncaughtException);

    expect(uncaught).to.eql([]);
    expect(await first).to.equal("value:a");
    expect(await last).to.equal("value:c");
    await middle.then(
      () => {
        throw new Error("expected middle command to reject");
      },
      (err) => {
        expect(err).to.be.an("error");
        expect(err.message).to.match(/is not a function/);
      }
    );
  });
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
