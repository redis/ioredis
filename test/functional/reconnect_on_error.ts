import Redis from "../../lib/Redis";
import { expect } from "chai";
import * as sinon from "sinon";

describe("reconnectOnError", () => {
  it("should pass the error as the first param", (done) => {
    let pending = 2;
    function assert(err) {
      expect(err.name).to.eql("ReplyError");
      expect(err.command.name).to.eql("set");
      expect(err.command.args).to.eql(["foo"]);
      if (!--pending) {
        done();
      }
    }
    const redis = new Redis({
      reconnectOnError: function (err) {
        assert(err);
        return 1;
      },
    });

    redis.set("foo", function (err) {
      assert(err);
    });
  });

  it("should not reconnect if reconnectOnError returns false", (done) => {
    const redis = new Redis({
      reconnectOnError: function (err) {
        return false;
      },
    });

    redis.disconnect = () => {
      throw new Error("should not disconnect");
    };

    redis.set("foo", function (err) {
      done();
    });
  });

  it("should reconnect if reconnectOnError returns true or 1", (done) => {
    const redis = new Redis({
      reconnectOnError: () => {
        return true;
      },
    });

    redis.set("foo", () => {
      redis.on("ready", () => {
        done();
      });
    });
  });

  it("should reconnect and retry the command if reconnectOnError returns 2", (done) => {
    const redis = new Redis({
      reconnectOnError: () => {
        redis.del("foo");
        return 2;
      },
    });

    redis.set("foo", "bar");
    redis.sadd("foo", "a", function (err, res) {
      expect(res).to.eql(1);
      done();
    });
  });

  it("should select the currect database", (done) => {
    const redis = new Redis({
      reconnectOnError: () => {
        redis.select(3);
        redis.del("foo");
        redis.select(0);
        return 2;
      },
    });

    redis.select(3);
    redis.set("foo", "bar");
    redis.sadd("foo", "a", function (err, res) {
      expect(res).to.eql(1);
      redis.select(3);
      redis.type("foo", function (err, type) {
        expect(type).to.eql("set");
        done();
      });
    });
  });

  it("should work with pipeline", (done) => {
    const redis = new Redis({
      reconnectOnError: () => {
        redis.del("foo");
        return 2;
      },
    });

    redis.set("foo", "bar");
    redis
      .pipeline()
      .get("foo")
      .sadd("foo", "a")
      .exec(function (err, res) {
        expect(res).to.eql([
          [null, "bar"],
          [null, 1],
        ]);
        done();
      });
  });

  it("should work with pipelined multi", (done) => {
    const redis = new Redis({
      reconnectOnError: () => {
        // deleting foo allows sadd below to succeed on the second try
        redis.del("foo");
        return 2;
      },
    });
    const delSpy = sinon.spy(redis, "del");

    redis.set("foo", "bar");
    redis.set("i", 1);
    redis
      .pipeline()
      .sadd("foo", "a") // trigger a WRONGTYPE error
      .multi()
      .get("foo")
      .incr("i")
      .exec()
      .exec(function (err, res) {
        expect(delSpy.calledOnce).to.eql(true);
        expect(delSpy.firstCall.args[0]).to.eql("foo");
        expect(err).to.be.null;
        expect(res).to.eql([
          [null, 1],
          [null, "OK"],
          [null, "QUEUED"],
          [null, "QUEUED"],
          [null, ["bar", 2]],
        ]);
        done();
      });
  });
});
