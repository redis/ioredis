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

  it("should keep two uncached slots in separate pipelines", async function () {
    const redis = new Redis(30000, {
      enableAutoPipelining: true,
      lazyConnect: true,
    });
    // A cluster whose slot cache is populated but holds no node group for any
    // slot: the state `client.slots[slot]` used to be indexed without a check.
    Object.defineProperty(redis, "isCluster", { value: true });
    (redis as any).slots = new Array(16384);
    (redis as any)._groupsBySlot = new Array(16384);
    // Only the buckets are read here; the pipelines themselves are not run.
    const exec = sinon.stub(Pipeline.prototype, "exec").callsFake(function () {
      return Promise.resolve([]);
    });

    try {
      (redis as any).get("a").catch(() => {});
      (redis as any).get("b").catch(() => {});
      // Two slots with no node group must not land in one pipeline: Pipeline
      // compares their two empty allocation groups as equal and would send
      // both commands to the first key's node.
      expect([...(redis as any)._autoPipelines.keys()]).to.have.lengthOf(2);
      // Let the pipelines scheduled above run while exec is still stubbed.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      exec.restore();
      redis.disconnect();
    }
  });

  it("should bucket string keys under a Buffer keyPrefix by their bytes", async function () {
    const redis = new Redis(30000, {
      enableAutoPipelining: true,
      lazyConnect: true,
      // keyPrefix is typed as a string, but a Buffer is supported
      keyPrefix: Buffer.from([0xff]) as unknown as string,
    });
    Object.defineProperty(redis, "isCluster", { value: true });
    // The prefixed keys' bytes hash to slots 12000 (node a) and 7811 (node
    // b). Every other slot is node b's, so only hashing those bytes splits
    // them.
    (redis as any).slots = new Array(16384).fill(["b"]);
    (redis as any).slots[12000] = ["a"];
    (redis as any)._groupsBySlot = new Array(16384);
    // Only the buckets are read here; the pipelines themselves are not run.
    const exec = sinon.stub(Pipeline.prototype, "exec").callsFake(function () {
      return Promise.resolve([]);
    });

    try {
      (redis as any).get("k0").catch(() => {});
      (redis as any).get("k3").catch(() => {});
      // One pipeline per node.
      expect([...(redis as any)._autoPipelines.keys()]).to.have.lengthOf(2);
      // Let the pipelines scheduled above run while exec is still stubbed.
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      exec.restore();
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
