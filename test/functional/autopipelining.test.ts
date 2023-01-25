import { describe, expect, it } from "@jest/globals";
import Redis from "../../lib/Redis";

describe("autoPipelining for single node", () => {
  it("should automatic add commands to auto pipelines", async () => {
    const redis = new Redis({ enableAutoPipelining: true });

    await redis.set("foo", "bar");
    expect(redis.autoPipelineQueueSize).toEqual(0);

    const promise = redis.get("foo");
    expect(redis.autoPipelineQueueSize).toEqual(1);

    const res = await promise;
    expect(res).toEqual("bar");
    expect(redis.autoPipelineQueueSize).toEqual(0);
  });

  it("should not add non-compatible commands to auto pipelines", async () => {
    const redis = new Redis({ enableAutoPipelining: true });

    expect(redis.autoPipelineQueueSize).toEqual(0);
    const promises: Promise<unknown>[] = [];

    promises.push(redis.subscribe("subscribe").catch(() => {}));
    promises.push(redis.unsubscribe("subscribe").catch(() => {}));

    expect(redis.autoPipelineQueueSize).toEqual(0);
    await Promise.all(promises);
  });

  it("should not add blacklisted commands to auto pipelines", async () => {
    const redis = new Redis({
      enableAutoPipelining: true,
      autoPipeliningIgnoredCommands: ["hmget"],
    });
    expect(redis.autoPipelineQueueSize).toEqual(0);

    const promise = redis.hmget("foo").catch(() => {});

    expect(redis.autoPipelineQueueSize).toEqual(0);
    await promise;
  });

  it("should support buffer commands", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    const buffer = Buffer.from("bar");
    await redis.set("foo", buffer);
    const promise = redis.getBuffer("foo");
    expect(redis.autoPipelineQueueSize).toEqual(1);
    expect(await promise).toEqual(buffer);
  });

  it("should support custom commands", async () => {
    const redis = new Redis({ enableAutoPipelining: true });

    redis.defineCommand("myecho", {
      numberOfKeys: 2,
      lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
    });

    // @ts-expect-error
    const promise = redis.myecho("foo1", "foo2", "bar1", "bar2");
    expect(redis.autoPipelineQueueSize).toEqual(1);
    expect(await promise).toEqual(["foo1", "foo2", "bar1", "bar2"]);

    // @ts-expect-error
    await redis.myecho("foo1", "foo2", "bar1", "bar2");
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
    ).toEqual(["call()", "call()", "call()", "call()", "call()"]);
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
    ).toEqual(["bar", "bar", "bar", "bar", "bar"]);
  });

  it("should support commands queued after a pipeline is already queued for execution", (done) => {
    const redis = new Redis({ enableAutoPipelining: true });
    let value1;
    expect(redis.autoPipelineQueueSize).toEqual(0);

    redis.set("foo1", "bar1", () => {});
    redis.set("foo2", "bar2", () => {});

    redis.get("foo1", (err, v1) => {
      expect(err).toBeNull();
      value1 = v1;
    });

    process.nextTick(() => {
      redis.get("foo2", (err, value2) => {
        expect(err).toBeNull();

        expect(value1).toEqual("bar1");
        expect(value2).toEqual("bar2");
        expect(redis.autoPipelineQueueSize).toEqual(0);

        done();
      });
    });

    expect(redis.autoPipelineQueueSize).toEqual(3);
  });

  it("should correctly track pipeline length", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    expect(redis.autoPipelineQueueSize).toEqual(0);
    const promise1 = redis.set("foo", "bar");
    expect(redis.autoPipelineQueueSize).toEqual(1);
    await promise1;

    expect(redis.autoPipelineQueueSize).toEqual(0);
    const promise2 = Promise.all([
      redis.get("foo"),
      redis.get("foo"),
      redis.get("foo"),
      redis.get("foo"),
      redis.get("foo"),
    ]);
    expect(redis.autoPipelineQueueSize).toEqual(5);
    await promise2;
  });

  it("should handle rejections", async () => {
    const redis = new Redis({ enableAutoPipelining: true });
    await redis.set("foo", "bar");
    // @ts-expect-error
    await expect(redis.set("foo")).rejects.toThrow(
      "ERR wrong number of arguments for 'set' command"
    );
  });

  it("should support callbacks in the happy case", (done) => {
    const redis = new Redis({ enableAutoPipelining: true });
    let value1;
    expect(redis.autoPipelineQueueSize).toEqual(0);

    redis.set("foo1", "bar1", () => {});

    expect(redis.autoPipelineQueueSize).toEqual(1);

    redis.set("foo2", "bar2", () => {
      redis.get("foo1", (err, v1) => {
        expect(err).toBeNull();
        value1 = v1;
      });

      expect(redis.autoPipelineQueueSize).toEqual(1);

      redis.get("foo2", (err, value2) => {
        expect(err).toBeNull();

        expect(value1).toEqual("bar1");
        expect(value2).toEqual("bar2");
        expect(redis.autoPipelineQueueSize).toEqual(0);
        done();
      });

      expect(redis.autoPipelineQueueSize).toEqual(2);
    });

    expect(redis.autoPipelineQueueSize).toEqual(2);
  });

  it("should support callbacks in the failure case", (done) => {
    const redis = new Redis({ enableAutoPipelining: true });
    expect(redis.autoPipelineQueueSize).toEqual(0);

    redis.set("foo1", "bar1", (err) => {
      expect(err).toBeNull();
    });

    expect(redis.autoPipelineQueueSize).toEqual(1);

    // @ts-expect-error
    redis.set("foo2", (err) => {
      expect(err.message).toContain(
        "ERR wrong number of arguments for 'set' command"
      );
      done();
    });

    expect(redis.autoPipelineQueueSize).toEqual(2);
  });

  // https://github.com/facebook/jest/issues/5620
  it.skip("should handle callbacks failures", (done) => {
    const listeners = process.listeners("uncaughtException");
    process.removeAllListeners("uncaughtException");

    process.once("uncaughtException", (err) => {
      expect(err.message).toEqual("ERROR");

      for (const listener of listeners) {
        process.on("uncaughtException", listener);
      }

      done();
    });

    const redis = new Redis({ enableAutoPipelining: true });
    expect(redis.autoPipelineQueueSize).toEqual(0);

    redis.set("foo1", "bar1", (err) => {
      console.log("==err", err, 1);
      expect(err).toBeNull();

      throw new Error("ERROR");
    });

    redis.set("foo2", "bar2", (err) => {
      console.log("==err", err, 2);
      expect(err).toBeNull();

      expect(redis.autoPipelineQueueSize).toEqual(0);
    });

    expect(redis.autoPipelineQueueSize).toEqual(2);
  });
});
