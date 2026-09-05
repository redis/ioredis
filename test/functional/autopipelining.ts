import { expect, use } from "chai";
import Redis from "../../lib/Redis";
import { getCommandsFromMonitor } from "../helpers/util";

use(require("chai-as-promised"));

describe("autoPipelining for single node", () => {
  it("should automatic add commands to auto pipelines", async () => {
    const redis = new Redis({ enableAutoPipelining: true });

    await redis.set("foo", "bar");
    expect(redis.autoPipelineQueueSize).to.eql(0);

    const promise = redis.get("foo");
    expect(redis.autoPipelineQueueSize).to.eql(1);

    const res = await promise;
    expect(res).to.eql("bar");
    expect(redis.autoPipelineQueueSize).to.eql(0);
  });

  it("should not add non-compatible commands to auto pipelines", async () => {
    const redis = new Redis({ enableAutoPipelining: true });

    expect(redis.autoPipelineQueueSize).to.eql(0);
    const promises = [];

    promises.push(redis.subscribe("subscribe").catch(() => {}));
    promises.push(redis.unsubscribe("subscribe").catch(() => {}));

    expect(redis.autoPipelineQueueSize).to.eql(0);
    await promises;
  });

  it("should work with db parameter", async () => {
    const redis = new Redis({ enableAutoPipelining: true, db: 1 });

    redis.set("foo", "bar");
    await new Promise((resolve) => {
      redis.once("ready", resolve);
    });
    expect(await redis.get("foo")).to.eql("bar");
  });

  it("should not add blacklisted commands to auto pipelines", async () => {
    const redis = new Redis({
      enableAutoPipelining: true,
      autoPipeliningIgnoredCommands: ["hmget"],
    });
    expect(redis.autoPipelineQueueSize).to.eql(0);

    const promise = redis.hmget("foo").catch(() => {});

    expect(redis.autoPipelineQueueSize).to.eql(0);
    await promise;
  });

  it("should support buffer commands", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    const buffer = Buffer.from("bar");
    await redis.set("foo", buffer);
    const promise = redis.getBuffer("foo");
    expect(redis.autoPipelineQueueSize).to.eql(1);
    expect(await promise).to.eql(buffer);
  });

  it("should support custom commands", async () => {
    const redis = new Redis({ enableAutoPipelining: true });

    redis.defineCommand("myecho", {
      numberOfKeys: 2,
      lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
    });

    // @ts-expect-error
    const promise = redis.myecho("foo1", "foo2", "bar1", "bar2");
    expect(redis.autoPipelineQueueSize).to.eql(1);
    expect(await promise).to.eql(["foo1", "foo2", "bar1", "bar2"]);

    // @ts-expect-error
    await redis.myecho("foo1", "foo2", "bar1", "bar2");
  });

  it("should align late custom command results in an existing auto pipeline", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    await redis.set("foo1", "bar1");

    // The get creates the auto pipeline before the custom command is defined.
    const existingResult = redis.get("foo1");
    redis.defineCommand("lateEcho", {
      numberOfKeys: 2,
      lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
    });

    // @ts-expect-error
    const stringResult = redis.lateEcho("foo1", "foo1", "bar1", "bar2");
    const bufferArg1 = Buffer.from("buffer1");
    const bufferArg2 = Buffer.from("buffer2");
    // @ts-expect-error
    const bufferResult = redis.lateEchoBuffer(
      "foo1",
      "foo1",
      bufferArg1,
      bufferArg2
    );

    expect(
      await Promise.all([existingResult, stringResult, bufferResult])
    ).to.eql([
      "bar1",
      ["foo1", "foo1", "bar1", "bar2"],
      [Buffer.from("foo1"), Buffer.from("foo1"), bufferArg1, bufferArg2],
    ]);
  });

  it("should recover late custom command callbacks after SCRIPT FLUSH", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    await redis.set("foo1", "bar1");

    const existingResult = redis.get("foo1");
    redis.defineCommand("lateGet", {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])',
    });
    // @ts-expect-error
    expect(await Promise.all([existingResult, redis.lateGet("foo1")])).to.eql([
      "bar1",
      "bar1",
    ]);
    await redis.script("FLUSH");

    // Observe the real NOSCRIPT retry, not only the eventual successful result.
    const commands = await getCommandsFromMonitor(redis, 5, async () => {
      const before = redis.get("foo1");
      const callbackResult = new Promise((resolve, reject) => {
        // @ts-expect-error
        redis.lateGet("foo1", (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
      const after = redis.get("foo1");
      expect(await Promise.all([before, callbackResult, after])).to.eql([
        "bar1",
        "bar1",
        "bar1",
      ]);
    });
    expect(commands.map((command) => command[0].toLowerCase())).to.eql([
      "get",
      "evalsha",
      "get",
      "eval",
      "get",
    ]);
  });

  it("should keep queued custom commands bound to their definition", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    await redis.set("foo1", "bar1");

    redis.defineCommand("redefineEcho", {
      numberOfKeys: 1,
      lua: "return 'old'",
    });
    // @ts-expect-error
    const oldResult = redis.redefineEcho("foo1");

    redis.defineCommand("redefineEcho", {
      numberOfKeys: 1,
      lua: "return 'new'",
    });
    // @ts-expect-error
    const newResult = redis.redefineEcho("foo1");
    // @ts-expect-error
    const newBufferResult = redis.redefineEchoBuffer("foo1");
    const getResult = redis.get("foo1");

    expect(
      await Promise.all([oldResult, newResult, newBufferResult, getResult])
    ).to.eql(["old", "new", Buffer.from("new"), "bar1"]);
  });

  it("should support call()", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    await redis.call("set", "foo", "call()");

    expect(
      await Promise.all([
        redis.get("foo"),
        redis.get("foo"),
        redis.get("foo"),
        redis.get("foo"),
        redis.get("foo"),
      ])
    ).to.eql(["call()", "call()", "call()", "call()", "call()"]);
  });

  it("should support multiple commands", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    await redis.set("foo", "bar");

    expect(
      await Promise.all([
        redis.get("foo"),
        redis.get("foo"),
        redis.get("foo"),
        redis.get("foo"),
        redis.get("foo"),
      ])
    ).to.eql(["bar", "bar", "bar", "bar", "bar"]);
  });

  it("should support commands queued after a pipeline is already queued for execution", (done) => {
    const redis = new Redis({ enableAutoPipelining: true });
    let value1;
    expect(redis.autoPipelineQueueSize).to.eql(0);

    redis.set("foo1", "bar1", () => {});
    redis.set("foo2", "bar2", () => {});

    redis.get("foo1", (err, v1) => {
      expect(err).to.eql(null);
      value1 = v1;
    });

    process.nextTick(() => {
      redis.get("foo2", (err, value2) => {
        expect(err).to.eql(null);

        expect(value1).to.eql("bar1");
        expect(value2).to.eql("bar2");
        expect(redis.autoPipelineQueueSize).to.eql(0);

        done();
      });
    });

    expect(redis.autoPipelineQueueSize).to.eql(3);
  });

  it("should correctly track pipeline length", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    expect(redis.autoPipelineQueueSize).to.eql(0);
    const promise1 = redis.set("foo", "bar");
    expect(redis.autoPipelineQueueSize).to.eql(1);
    await promise1;

    expect(redis.autoPipelineQueueSize).to.eql(0);
    const promise2 = Promise.all([
      redis.get("foo"),
      redis.get("foo"),
      redis.get("foo"),
      redis.get("foo"),
      redis.get("foo"),
    ]);
    expect(redis.autoPipelineQueueSize).to.eql(5);
    await promise2;
  });

  it("should handle rejections", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    await redis.set("foo", "bar");
    // @ts-expect-error
    await expect(redis.set("foo")).to.eventually.be.rejectedWith(
      "ERR wrong number of arguments for 'set' command"
    );
  });

  it("should support callbacks in the happy case", (done) => {
    const redis = new Redis({ enableAutoPipelining: true });
    let value1;
    expect(redis.autoPipelineQueueSize).to.eql(0);

    redis.set("foo1", "bar1", () => {});

    expect(redis.autoPipelineQueueSize).to.eql(1);

    redis.set("foo2", "bar2", () => {
      redis.get("foo1", (err, v1) => {
        expect(err).to.eql(null);
        value1 = v1;
      });

      expect(redis.autoPipelineQueueSize).to.eql(1);

      redis.get("foo2", (err, value2) => {
        expect(err).to.eql(null);

        expect(value1).to.eql("bar1");
        expect(value2).to.eql("bar2");
        expect(redis.autoPipelineQueueSize).to.eql(0);
        done();
      });

      expect(redis.autoPipelineQueueSize).to.eql(2);
    });

    expect(redis.autoPipelineQueueSize).to.eql(2);
  });

  it("should support callbacks in the failure case", (done) => {
    const redis = new Redis({ enableAutoPipelining: true });
    expect(redis.autoPipelineQueueSize).to.eql(0);

    redis.set("foo1", "bar1", (err) => {
      expect(err).to.eql(null);
    });

    expect(redis.autoPipelineQueueSize).to.eql(1);

    // @ts-expect-error
    redis.set("foo2", (err) => {
      expect(err.message).to.include(
        "ERR wrong number of arguments for 'set' command"
      );
      done();
    });

    expect(redis.autoPipelineQueueSize).to.eql(2);
  });

  it("should handle large pipelines without RangeError", async () => {
    const redis = new Redis({ enableAutoPipelining: true });

    const largeValue = "x".repeat(1024 * 1024);
    await Promise.all(
      Array.from({ length: 600 }, (_, i) => redis.set(`key${i}`, largeValue))
    );

    const results = await Promise.all(
      Array.from({ length: 600 }, (_, i) => redis.get(`key${i}`))
    );

    expect(results[0]).to.eql(largeValue);
    expect(results[599]).to.eql(largeValue);
  });

  it("should handle callbacks failures", (done) => {
    const listeners = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");

    process.once("uncaughtException", (err) => {
      expect(err.message).to.eql("ERROR");

      for (const listener of listeners) {
        process.on("uncaughtException", listener);
      }

      done();
    });

    const redis = new Redis({ enableAutoPipelining: true });
    expect(redis.autoPipelineQueueSize).to.eql(0);

    redis.set("foo1", "bar1", (err) => {
      expect(err).to.eql(null);

      throw new Error("ERROR");
    });

    redis.set("foo2", "bar2", (err) => {
      expect(err).to.eql(null);

      expect(redis.autoPipelineQueueSize).to.eql(0);
    });

    expect(redis.autoPipelineQueueSize).to.eql(2);
  });
});
