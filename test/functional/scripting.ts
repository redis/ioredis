import Redis from "../../lib/Redis";
import { expect } from "chai";
import * as sinon from "sinon";
import { getCommandsFromMonitor } from "../helpers/util";

describe("scripting", () => {
  describe("#numberOfKeys", () => {
    it("should recognize the numberOfKeys property", (done) => {
      const redis = new Redis();

      redis.defineCommand("test", {
        numberOfKeys: 2,
        lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
      });

      redis.test("k1", "k2", "a1", "a2", function (err, result) {
        expect(result).to.eql(["k1", "k2", "a1", "a2"]);
        redis.disconnect();
        done();
      });
    });

    it("should support dynamic key count", (done) => {
      const redis = new Redis();

      redis.defineCommand("test", {
        lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
      });

      redis.test(2, "k1", "k2", "a1", "a2", function (err, result) {
        expect(result).to.eql(["k1", "k2", "a1", "a2"]);
        redis.disconnect();
        done();
      });
    });

    it("should support numberOfKeys being 0", (done) => {
      const redis = new Redis();

      redis.defineCommand("test", {
        numberOfKeys: 0,
        lua: "return {ARGV[1],ARGV[2]}",
      });

      redis.test("2", "a2", function (err, result) {
        expect(result).to.eql(["2", "a2"]);
        redis.disconnect();
        done();
      });
    });

    it("should throw when numberOfKeys is omit", (done) => {
      const redis = new Redis();

      redis.defineCommand("test", {
        lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
      });

      redis.test("k1", "k2", "a1", "a2", function (err, result) {
        expect(err).to.be.instanceof(Error);
        expect(err.toString()).to.match(/value is not an integer/);
        redis.disconnect();
        done();
      });
    });
  });

  it("should have a buffer version", (done) => {
    const redis = new Redis();

    redis.defineCommand("test", {
      numberOfKeys: 2,
      lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
    });

    redis.testBuffer("k1", "k2", "a1", "a2", function (err, result) {
      expect(result).to.eql([
        Buffer.from("k1"),
        Buffer.from("k2"),
        Buffer.from("a1"),
        Buffer.from("a2"),
      ]);
      redis.disconnect();
      done();
    });
  });

  it("should work well with pipeline", (done) => {
    const redis = new Redis();

    redis.defineCommand("test", {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])',
    });

    redis
      .pipeline()
      .set("test", "pipeline")
      .test("test")
      .exec(function (err, results) {
        expect(results).to.eql([
          [null, "OK"],
          [null, "pipeline"],
        ]);
        redis.disconnect();
        done();
      });
  });

  it("should following pipeline style when throw", (done) => {
    const redis = new Redis();

    redis.defineCommand("test", {
      lua: 'return redis.call("get", KEYS[1])',
    });

    redis
      .pipeline()
      .set("test", "pipeline")
      .test("test")
      .exec(function (err, results) {
        expect(err).to.eql(null);
        expect(results[1][0]).to.be.instanceof(Error);
        expect(results[1][0].message).to.match(/value is not an integer/);
        redis.disconnect();
        done();
      });
  });

  it("should use evalsha when script is loaded", async () => {
    const redis = new Redis();

    redis.defineCommand("test", { lua: "return 1" });
    await redis.test(0);

    const commands = await getCommandsFromMonitor(redis, 1, () => {
      return redis.test(0);
    });

    expect(commands[0]).to.eql([
      "evalsha",
      "e0e1f9fabfc9d4800c877a703b823ac0578ff8db",
      "0",
    ]);
  });

  it("should try to use EVALSHA and fallback to EVAL if fails", async () => {
    const redis = new Redis();

    redis.defineCommand("test", {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])',
    });

    await redis.test("preload");
    await redis.script("flush");

    const commands = await getCommandsFromMonitor(redis, 5, async () => {
      await redis.test("foo");
      await redis.test("bar");
    });

    const expectedComands = ["evalsha", "eval", "get", "evalsha", "get"];
    expect(commands.map((c) => c[0])).to.eql(expectedComands);
  });

  it("should load scripts first before execution of pipeline", async () => {
    const redis = new Redis();

    redis.defineCommand("testGet", {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])',
    });

    await redis.testGet("init");

    redis.defineCommand("testSet", {
      numberOfKeys: 1,
      lua: 'return redis.call("set", KEYS[1], "bar")',
    });

    const commands = await getCommandsFromMonitor(redis, 5, () => {
      return redis.pipeline().testGet("foo").testSet("foo").get("foo").exec();
    });

    const expectedComands = ["evalsha", "get", "eval", "set", "get"];

    expect(commands.map((c) => c[0])).to.eql(expectedComands);
  });

  it("does not fallback to EVAL in regular transaction", async () => {
    const redis = new Redis();

    redis.defineCommand("test", {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])',
    });

    await redis.test("preload");
    await redis.script("flush");
    const spy = sinon.spy(redis, "sendCommand");
    const commands = await getCommandsFromMonitor(redis, 4, async () => {
      const [a, b] = await redis.multi().test("foo").test("bar").exec();

      expect(a[0].message).to.equal(
        "NOSCRIPT No matching script. Please use EVAL."
      );
      expect(b[0].message).to.equal(
        "NOSCRIPT No matching script. Please use EVAL."
      );
    });
    spy.restore();
    expect(spy.callCount).to.equal(4);
    const expectedComands = ["multi", "evalsha", "evalsha", "exec"];
    expect(commands.map((c) => c[0])).to.eql(expectedComands);
  });

  it("does not fallback to EVAL in manual transaction", async () => {
    const redis = new Redis();

    redis.defineCommand("test", {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])',
    });

    await redis.test("preload");
    await redis.script("flush");
    const spy = sinon.spy(redis, "sendCommand");
    const commands = await getCommandsFromMonitor(redis, 4, async () => {
      await redis
        .pipeline([["multi"], ["test", "foo"], ["test", "bar"], ["exec"]])
        .exec();
    });
    spy.restore();
    expect(spy.callCount).to.equal(4);
    const expectedComands = ["multi", "evalsha", "evalsha", "exec"];
    expect(commands.map((c) => c[0])).to.eql(expectedComands);
  });

  it("should support key prefixing", (done) => {
    const redis = new Redis({ keyPrefix: "foo:" });

    redis.defineCommand("echo", {
      numberOfKeys: 2,
      lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
    });

    redis.echo("k1", "k2", "a1", "a2", function (err, result) {
      expect(result).to.eql(["foo:k1", "foo:k2", "a1", "a2"]);
      redis.disconnect();
      done();
    });
  });
});
