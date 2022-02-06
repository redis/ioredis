import Redis from "../../lib/Redis";
import { expect } from "chai";
import * as sinon from "sinon";

describe("pipeline", function () {
  it("should return correct result", function (done) {
    const redis = new Redis();
    redis
      .pipeline()
      .set("foo", "1")
      .get("foo")
      .set("foo", "2")
      .incr("foo")
      .get("foo")
      .exec(function (err, results) {
        expect(err).to.eql(null);
        expect(results).to.eql([
          [null, "OK"],
          [null, "1"],
          [null, "OK"],
          [null, 3],
          [null, "3"],
        ]);
        redis.disconnect();
        done();
      });
  });

  it("should return an empty array on empty pipeline", function (done) {
    const redis = new Redis();
    redis.pipeline().exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results).to.eql([]);
      redis.disconnect();
      done();
    });
  });

  it("should support mix string command and buffer command", function (done) {
    const redis = new Redis();
    redis
      .pipeline()
      .set("foo", "bar")
      .set("foo", Buffer.from("bar"))
      .getBuffer("foo")
      .get(Buffer.from("foo"))
      .exec(function (err, results) {
        expect(err).to.eql(null);
        expect(results).to.eql([
          [null, "OK"],
          [null, "OK"],
          [null, Buffer.from("bar")],
          [null, "bar"],
        ]);
        redis.disconnect();
        done();
      });
  });

  it("should handle error correctly", function (done) {
    const redis = new Redis();
    redis
      .pipeline()
      .set("foo")
      .exec(function (err, results) {
        expect(err).to.eql(null);
        expect(results.length).to.eql(1);
        expect(results[0].length).to.eql(1);
        expect(results[0][0].toString()).to.match(/wrong number of arguments/);
        redis.disconnect();
        done();
      });
  });

  it("should also invoke the command's callback", function (done) {
    const redis = new Redis();
    let pending = 1;
    redis
      .pipeline()
      .set("foo", "bar")
      .get("foo", function (err, result) {
        expect(result).to.eql("bar");
        pending -= 1;
      })
      .exec(function (err, results) {
        expect(pending).to.eql(0);
        expect(results[1][1]).to.eql("bar");
        redis.disconnect();
        done();
      });
  });

  it("should support inline transaction", function (done) {
    const redis = new Redis();

    redis
      .pipeline()
      .multi()
      .set("foo", "bar")
      .get("foo")
      .exec()
      .exec(function (err, result) {
        expect(result[0][1]).to.eql("OK");
        expect(result[1][1]).to.eql("QUEUED");
        expect(result[2][1]).to.eql("QUEUED");
        expect(result[3][1]).to.eql(["OK", "bar"]);
        redis.disconnect();
        done();
      });
  });

  it("should have the same options as its container", function () {
    const redis = new Redis({ showFriendlyErrorStack: true });
    const pipeline = redis.pipeline();
    expect(pipeline.options).to.have.property("showFriendlyErrorStack", true);
    redis.disconnect();
  });

  it("should support key prefixing", function (done) {
    const redis = new Redis({ keyPrefix: "foo:" });
    redis
      .pipeline()
      .set("bar", "baz")
      .get("bar")
      .lpush("app1", "test1")
      .lpop("app1")
      .keys("*")
      .exec(function (err, results) {
        expect(err).to.eql(null);
        expect(results).to.eql([
          [null, "OK"],
          [null, "baz"],
          [null, 1],
          [null, "test1"],
          [null, ["foo:bar"]],
        ]);
        redis.disconnect();
        done();
      });
  });

  it("should include added built in commands", async () => {
    const redis = new Redis({ keyPrefix: "foo:" });
    redis.addBuiltinCommand("someCommand");
    sinon.stub(redis, "sendCommand").callsFake((command) => {
      command.resolve(Buffer.from("OK"));
    });
    const result = await redis.pipeline().someCommand().exec();
    expect(result).to.eql([[null, "OK"]]);
  });

  describe("custom commands", function () {
    let redis;

    beforeEach(function () {
      redis = new Redis();
      redis.defineCommand("echo", {
        numberOfKeys: 2,
        lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
      });
    });

    afterEach(function () {
      redis.disconnect();
    });

    it("should work", function (done) {
      redis
        .pipeline()
        .echo("foo", "bar", "123", "abc")
        .exec(function (err, results) {
          expect(err).to.eql(null);
          expect(results).to.eql([[null, ["foo", "bar", "123", "abc"]]]);
          done();
        });
    });

    it("should support callbacks", function (done) {
      let pending = 1;
      redis
        .pipeline()
        .echo("foo", "bar", "123", "abc", function (err, result) {
          pending -= 1;
          expect(err).to.eql(null);
          expect(result).to.eql(["foo", "bar", "123", "abc"]);
        })
        .exec(function (err, results) {
          expect(err).to.eql(null);
          expect(results).to.eql([[null, ["foo", "bar", "123", "abc"]]]);
          expect(pending).to.eql(0);
          done();
        });
    });

    it("should be supported in transaction blocks", function (done) {
      redis
        .pipeline()
        .multi()
        .set("foo", "asdf")
        .echo("bar", "baz", "123", "abc")
        .get("foo")
        .exec()
        .exec(function (err, results) {
          expect(err).to.eql(null);
          expect(results[4][1][1]).to.eql(["bar", "baz", "123", "abc"]);
          expect(results[4][1][2]).to.eql("asdf");
          done();
        });
    });
  });

  describe("#addBatch", function () {
    it("should accept commands in constructor", function (done) {
      const redis = new Redis();
      let pending = 1;
      redis
        .pipeline([
          ["set", "foo", "bar"],
          [
            "get",
            "foo",
            function (err, result) {
              expect(result).to.eql("bar");
              pending -= 1;
            },
          ],
        ])
        .exec(function (err, results) {
          expect(pending).to.eql(0);
          expect(results[1][1]).to.eql("bar");
          redis.disconnect();
          done();
        });
    });
  });

  describe("exec", function () {
    it("should group results", function (done) {
      const redis = new Redis();
      redis.multi({ pipeline: false });
      redis.set("foo", "bar");
      redis.get("foo");
      redis.exec().then(function () {
        redis.disconnect();
        done();
      });
    });

    it("should allow omitting callback", function (done) {
      const redis = new Redis();
      redis.exec().catch(function (err) {
        expect(err.message).to.eql("ERR EXEC without MULTI");
        redis.disconnect();
        done();
      });
    });

    it("should batch all commands before ready event", function (done) {
      const redis = new Redis();
      redis.on("connect", function () {
        redis
          .pipeline()
          .info()
          .config("get", "maxmemory")
          .exec(function (err, res) {
            expect(err).to.eql(null);
            expect(res).to.have.lengthOf(2);
            expect(res[0][0]).to.eql(null);
            expect(typeof res[0][1]).to.eql("string");
            expect(res[1][0]).to.eql(null);
            expect(Array.isArray(res[1][1])).to.eql(true);
            redis.disconnect();
            done();
          });
      });
    });

    it("should check and load uniq scripts only", function (done) {
      const redis = new Redis();
      redis.defineCommand("test", {
        numberOfKeys: 2,
        lua: "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}",
      });
      redis.defineCommand("echo", {
        numberOfKeys: 1,
        lua: "return {KEYS[1],ARGV[1]}",
      });

      redis.once("ready", function () {
        const expectedCommands = [
          ["script", "exists"],
          ["script", "load", "return {KEYS[1],ARGV[1]}"],
          ["script", "load", "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}"],
          ["evalsha"],
          ["evalsha"],
          ["evalsha"],
          ["evalsha"],
          ["evalsha"],
          ["evalsha"],
        ];
        const expectedResults = [
          [null, ["a", "1"]],
          [null, ["b", "2"]],
          [null, ["k1", "k2", "v1", "v2"]],
          [null, ["k3", "k4", "v3", "v4"]],
          [null, ["c", "3"]],
          [null, ["k5", "k6", "v5", "v6"]],
        ];
        redis.monitor(function (err, monitor) {
          monitor.on("monitor", function (_, command) {
            const expectedCommand = expectedCommands.shift();
            expectedCommand.forEach((arg, i) => expect(arg).to.eql(command[i]));
            if (!expectedCommands.length) {
              monitor.disconnect();
              redis.disconnect();
              done();
            }
          });
          const pipe = redis.pipeline();
          pipe
            .echo("a", "1")
            .echo("b", "2")
            .test("k1", "k2", "v1", "v2")
            .test("k3", "k4", "v3", "v4")
            .echo("c", "3")
            .test("k5", "k6", "v5", "v6")
            .exec(function (err, results) {
              expect(err).to.eql(null);
              expect(results).to.eql(expectedResults);
            });
        });
      });
    });

    it("should support parallel script execution", function (done) {
      const random = `${Math.random()}`;
      const redis = new Redis();
      redis.defineCommand("something", {
        numberOfKeys: 0,
        lua: `return "${random}"`,
      });
      Promise.all([
        redis.multi([["something"]]).exec(),
        redis.multi([["something"]]).exec(),
      ])
        .then(([[first], [second]]) => {
          expect(first[0]).to.equal(null);
          expect(first[1]).to.equal(random);
          expect(second[0]).to.equal(null);
          expect(second[1]).to.equal(random);
          redis.disconnect();
          done();
        })
        .catch(done);
    });

    it("should reload scripts on redis restart (reconnect)", async function () {
      const redis = new Redis({ connectionName: "load-script-on-reconnect" });
      const redis2 = new Redis();
      redis.defineCommand("exeecafterreconnect", {
        numberOfKeys: 0,
        lua: `return "OK"`,
      });

      const [[err, res]] = await redis.multi([["exeecafterreconnect"]]).exec();
      expect(err).to.equal(null);
      expect(res).to.equal("OK");

      const client = await redis.client("list").then((clients) => {
        const myInfo = clients
          .split("\n")
          .find((client) => client.includes("load-script-on-reconnect"));

        const match = / addr=([^ ]+)/.exec(myInfo);
        if (match) return match[1];
      });

      await redis2.script("flush");
      await redis2.client("kill", "addr", client);

      // Wait for reconnect, at the moment scripts are not loaded
      // if the pipeline starts before ioredis reconnects
      await redis.ping();

      const [[err2, res2]] = await redis
        .multi([["exeecafterreconnect"]])
        .exec();

      expect(err2).to.equal(null);
      expect(res2).to.equal("OK");
      redis.disconnect();
      redis2.disconnect();
    });
  });

  describe("#length", function () {
    it("return the command count", function () {
      const redis = new Redis();

      const pipeline1 = redis
        .pipeline()
        .multi()
        .set("foo", "bar")
        .get("foo")
        .exec();
      expect(pipeline1.length).to.eql(4);

      const pipeline2 = redis.pipeline([
        ["set", "foo", "bar"],
        ["get", "foo"],
      ]);
      expect(pipeline2.length).to.eql(2);
      redis.disconnect();
    });
  });
});
