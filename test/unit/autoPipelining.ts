import { expect } from "chai";
import * as sinon from "sinon";
import Command from "../../lib/Command";
import Pipeline from "../../lib/Pipeline";
import Redis from "../../lib/Redis";
import { getFirstValueInFlattenedArray } from "../../lib/autoPipelining";
import MockServer from "../helpers/mock_server";

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

  it("should not misalign replies after a synchronous enqueue failure", async () => {
    const received: string[] = [];
    new MockServer(30000, (argv) => {
      if (argv[0] === "get") {
        received.push(argv[1]);
        return argv[1];
      }
    });
    const redis = new Redis(30000, {
      enableAutoPipelining: true,
      enableReadyCheck: false,
    });
    const enqueueError = new Error("cannot enqueue this command");
    const sendCommand = Pipeline.prototype.sendCommand;
    const stub = sinon
      .stub(Pipeline.prototype, "sendCommand")
      .callsFake(function (this: Pipeline, command: Command) {
        if (command.name === "get" && command.args[0] === "rejected") {
          throw enqueueError;
        }
        return sendCommand.call(this, command);
      });

    try {
      const results = await Promise.allSettled([
        redis.get("before"),
        redis.get("rejected"),
        redis.get("after"),
      ]);

      expect(results).to.eql([
        { status: "fulfilled", value: "before" },
        { status: "rejected", reason: enqueueError },
        { status: "fulfilled", value: "after" },
      ]);
      expect(received).to.eql(["before", "after"]);
    } finally {
      stub.restore();
      redis.disconnect();
    }
  });

  it("should enqueue builtins added after a pipeline was created", async () => {
    const received: string[] = [];
    new MockServer(30000, (argv) => {
      if (argv[0] === "get" || argv[0] === "lateget") {
        received.push(argv[1]);
        return argv[1] === "rejected"
          ? new Error("ERR command rejected")
          : argv[1];
      }
    });
    const redis = new Redis(30000, {
      enableAutoPipelining: true,
      enableReadyCheck: false,
    });

    try {
      const before = redis.get("before");
      redis.addBuiltinCommand("lateget");
      // @ts-expect-error
      const stringResult = redis.lateget("string");
      // @ts-expect-error
      const bufferResult = redis.lategetBuffer("buffer");
      // @ts-expect-error
      const rejected = redis
        .lateget("rejected")
        .catch((err: Error) => err.message);

      expect(
        await Promise.all([
          before,
          stringResult,
          bufferResult,
          rejected,
          redis.get("after"),
        ])
      ).to.eql([
        "before",
        "string",
        Buffer.from("buffer"),
        "ERR command rejected",
        "after",
      ]);
      expect(received).to.eql([
        "before",
        "string",
        "buffer",
        "rejected",
        "after",
      ]);
    } finally {
      redis.disconnect();
    }
  });
});
