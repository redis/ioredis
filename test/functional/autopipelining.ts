import { expect, use } from "chai";
import Redis from "../../lib/redis";

use(require("chai-as-promised"));

describe("autoPipelining for single node", function () {
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
    await redis.setBuffer("foo", buffer);
    const promise = redis.getBuffer("foo");
    expect(redis.autoPipelineQueueSize).to.eql(1);
    expect(await promise).to.eql(buffer);
  });

  it("should support custom commands", async () => {
    const redis = new Redis({ enableAutoPipelining: true });

    redis.defineCommand("echo", {
      numberOfKeys: 2,
      lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
    });

    const promise = redis.echo("foo1", "foo2", "bar1", "bar2");
    expect(redis.autoPipelineQueueSize).to.eql(1);
    expect(await promise).to.eql(["foo1", "foo2", "bar1", "bar2"]);

    await redis.echo("foo1", "foo2", "bar1", "bar2");
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

    redis.set("foo2", (err) => {
      expect(err.message).to.eql(
        "ERR wrong number of arguments for 'set' command"
      );
      done();
    });

    expect(redis.autoPipelineQueueSize).to.eql(2);
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
