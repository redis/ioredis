import Redis from "../../lib/redis";
import { expect } from "chai";

describe("scripting", function () {
  describe("#numberOfKeys", function () {
    it("should recognize the numberOfKeys property", function (done) {
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

    it("should support dynamic key count", function (done) {
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

    it("should support numberOfKeys being 0", function (done) {
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

    it("should throw when numberOfKeys is omit", function (done) {
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

  it("should have a buffer version", function (done) {
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

  it("should work well with pipeline", function (done) {
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

  it("should following pipeline style when throw", function (done) {
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
        expect(results[1][0].toString()).to.match(/value is not an integer/);
        redis.disconnect();
        done();
      });
  });

  it("should use evalsha when script is loaded", function (done) {
    const redis = new Redis();

    redis.on("ready", function () {
      redis.defineCommand("test", {
        lua: "return 1",
      });
      redis.monitor(function (err, monitor) {
        let sent = false;
        monitor.on("monitor", function (_, command) {
          if (!sent) {
            sent = true;
            expect(command[0]).to.eql("evalsha");
            monitor.disconnect();
            done();
          }
        });
        redis.test(0, function () {
          redis.disconnect();
        });
      });
    });
  });

  it("should try to use EVALSHA and fallback to EVAL if fails", function (done) {
    const redis = new Redis();

    redis.defineCommand("test", {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])',
    });

    redis.once("ready", function () {
      const flush = new Redis();
      flush.script("flush", function () {
        const expectedComands = ["evalsha", "eval", "get", "evalsha", "get"];
        redis.monitor(function (err, monitor) {
          monitor.on("monitor", function (_, command) {
            const name = expectedComands.shift();
            expect(name).to.eql(command[0]);
            if (!expectedComands.length) {
              monitor.disconnect();
              redis.disconnect();
              done();
            }
          });
          redis.test("bar", function () {
            redis.test("foo");
          });
        });
      });
    });
  });

  it("should load scripts first before execute pipeline", function (done) {
    const redis = new Redis();

    redis.defineCommand("testGet", {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])',
    });

    redis.testGet("init", function () {
      redis.defineCommand("testSet", {
        numberOfKeys: 1,
        lua: 'return redis.call("set", KEYS[1], "bar")',
      });
      const expectedComands = [
        "script",
        "script",
        "evalsha",
        "get",
        "evalsha",
        "set",
        "get",
      ];
      redis.monitor(function (err, monitor) {
        monitor.on("monitor", function (_, command) {
          const name = expectedComands.shift();
          expect(name).to.eql(command[0]);
          if (!expectedComands.length) {
            monitor.disconnect();
            redis.disconnect();
            done();
          }
        });
        const pipe = redis.pipeline();
        pipe.testGet("foo").testSet("foo").get("foo").exec();
      });
    });
  });

  it("should support key prefixing", function (done) {
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
