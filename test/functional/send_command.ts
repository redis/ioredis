import Redis from "../../lib/Redis";
import { expect } from "chai";
import { StreamNotWritable } from "../../lib/errors";

describe("send command", () => {
  it("should support callback", (done) => {
    const redis = new Redis();
    redis.set("foo", "bar");
    redis.get("foo", function (err, result) {
      expect(result).to.eql("bar");
      done();
    });
  });

  it("should support promise", () => {
    const redis = new Redis();
    redis.set("foo", "bar");
    return redis.get("foo").then(function (result) {
      expect(result).to.eql("bar");
    });
  });

  it("should keep the response order when mix using callback & promise", (done) => {
    const redis = new Redis();
    let order = 0;
    redis.get("foo").then(() => {
      expect(++order).to.eql(1);
    });
    redis.get("foo", () => {
      expect(++order).to.eql(2);
    });
    redis.get("foo").then(() => {
      expect(++order).to.eql(3);
    });
    redis.get("foo", () => {
      expect(++order).to.eql(4);
      done();
    });
  });

  it("should support get & set buffer", (done) => {
    const redis = new Redis();
    redis.set(Buffer.from("foo"), Buffer.from("bar"), function (err, res) {
      expect(res).to.eql("OK");
    });
    redis.getBuffer(Buffer.from("foo"), function (err, result) {
      expect(result).to.be.instanceof(Buffer);
      expect(result.toString()).to.eql("bar");
      done();
    });
  });

  it("should support get & set buffer via `call`", (done) => {
    const redis = new Redis();
    redis.call(
      "set",
      Buffer.from("foo"),
      Buffer.from("bar"),
      function (err, res) {
        expect(res).to.eql("OK");
      }
    );
    redis.callBuffer("get", Buffer.from("foo"), function (err, result) {
      expect(result).to.be.instanceof(Buffer);
      expect(result.toString()).to.eql("bar");
      done();
    });
  });

  it("should handle empty buffer", (done) => {
    const redis = new Redis();
    redis.set(Buffer.from("foo"), Buffer.from(""));
    redis.getBuffer(Buffer.from("foo"), function (err, result) {
      expect(result).to.be.instanceof(Buffer);
      expect(result.toString()).to.eql("");
      done();
    });
  });

  it("should support utf8", (done) => {
    const redis = new Redis();
    redis.set(Buffer.from("你好"), String("你好"));
    redis.getBuffer("你好", function (err, result) {
      expect(result.toString()).to.eql("你好");
      redis.get("你好", function (err, result) {
        expect(result).to.eql("你好");
        done();
      });
    });
  });

  it("should consider null as empty str", (done) => {
    const redis = new Redis();
    redis.set("foo", null, () => {
      redis.get("foo", function (err, res) {
        expect(res).to.eql("");
        done();
      });
    });
  });

  it("should support return int value", (done) => {
    const redis = new Redis();
    redis.exists("foo", function (err, exists) {
      expect(typeof exists).to.eql("number");
      done();
    });
  });

  it("should reject when disconnected", (done) => {
    const redis = new Redis();
    redis.disconnect();
    redis.get("foo", function (err) {
      expect(err.message).to.match(/Connection is closed./);
      done();
    });
  });

  it("should reject when enableOfflineQueue is disabled", (done) => {
    const redis = new Redis({ enableOfflineQueue: false });
    redis.get("foo", function (err) {
      expect(err.message).to.match(/enableOfflineQueue options is false/);
      done();
    });
  });

  it("should support key prefixing", (done) => {
    const redis = new Redis({ keyPrefix: "foo:" });
    redis.set("bar", "baz");
    redis.get("bar", function (err, result) {
      expect(result).to.eql("baz");
      redis.keys("*", function (err, result) {
        expect(result).to.eql(["foo:bar"]);
        done();
      });
    });
  });

  it("should support key prefixing with multiple keys", (done) => {
    const redis = new Redis({ keyPrefix: "foo:" });
    redis.lpush("app1", "test1");
    redis.lpush("app2", "test2");
    redis.lpush("app3", "test3");
    redis.blpop("app1", "app2", "app3", 0, function (err, result) {
      expect(result).to.eql(["foo:app1", "test1"]);
      redis.keys("*", function (err, result) {
        expect(result).to.have.members(["foo:app2", "foo:app3"]);
        done();
      });
    });
  });

  it("should support prefixing buffer keys", async () => {
    const redis = new Redis({ keyPrefix: "foo:" });
    await redis.mset(
      Buffer.from("bar"),
      Buffer.from("baz"),
      Buffer.from("foo"),
      Buffer.from("baz")
    );
    await redis.set(Buffer.from([0xff]), Buffer.from("baz"));

    const redisWOPrefix = new Redis();
    expect(await redisWOPrefix.get("foo:bar")).to.eql("baz");
    expect(await redisWOPrefix.get("foo:foo")).to.eql("baz");
    expect(
      await redisWOPrefix.get(Buffer.from([0x66, 0x6f, 0x6f, 0x3a, 0xff]))
    ).to.eql("baz");
  });

  it("should support buffer as keyPrefix", async () => {
    // @ts-expect-error
    const redis = new Redis({ keyPrefix: Buffer.from([0xff]) });
    await redis.mset("bar", Buffer.from("baz"), "foo", Buffer.from("bar"));
    await redis.set(Buffer.from([0xff]), Buffer.from("baz"));

    const redisWOPrefix = new Redis();
    expect(
      await redisWOPrefix.get(Buffer.from([0xff, 0x62, 0x61, 0x72]))
    ).to.eql("baz");
    expect(
      await redisWOPrefix.get(Buffer.from([0xff, 0x66, 0x6f, 0x6f]))
    ).to.eql("bar");
    expect(await redisWOPrefix.get(Buffer.from([0xff, 0xff]))).to.eql("baz");
  });

  it("should support key prefixing for zunionstore", (done) => {
    const redis = new Redis({ keyPrefix: "foo:" });
    redis.zadd("zset1", 1, "one");
    redis.zadd("zset1", 2, "two");
    redis.zadd("zset2", 1, "one");
    redis.zadd("zset2", 2, "two");
    redis.zadd("zset2", 3, "three");
    redis.zunionstore(
      "out",
      2,
      "zset1",
      "zset2",
      "WEIGHTS",
      2,
      3,
      function (err, result) {
        expect(result).to.eql(3);
        redis.keys("*", function (err, result) {
          expect(result).to.have.members(["foo:zset1", "foo:zset2", "foo:out"]);
          done();
        });
      }
    );
  });

  it("should support key prefixing for sort", (done) => {
    const redis = new Redis({ keyPrefix: "foo:" });
    redis.hset("object_1", "name", "better");
    redis.hset("weight_1", "value", "20");
    redis.hset("object_2", "name", "best");
    redis.hset("weight_2", "value", "30");
    redis.hset("object_3", "name", "good");
    redis.hset("weight_3", "value", "10");
    redis.lpush("src", "1", "2", "3");
    redis.sort(
      "src",
      "BY",
      "weight_*->value",
      "GET",
      "object_*->name",
      "STORE",
      "dest",
      function (err, result) {
        redis.lrange("dest", 0, -1, function (err, result) {
          expect(result).to.eql(["good", "better", "best"]);
          redis.keys("*", function (err, result) {
            expect(result).to.have.members([
              "foo:object_1",
              "foo:weight_1",
              "foo:object_2",
              "foo:weight_2",
              "foo:object_3",
              "foo:weight_3",
              "foo:src",
              "foo:dest",
            ]);
            done();
          });
        });
      }
    );
  });

  it("should allow sending the loading valid commands in connect event", (done) => {
    const redis = new Redis({ enableOfflineQueue: false });
    redis.on("connect", () => {
      redis.select(2, function (err, res) {
        expect(res).to.eql("OK");
        done();
      });
    });
  });

  it("should reject loading invalid commands in connect event", (done) => {
    const redis = new Redis({ enableOfflineQueue: false });
    redis.on("connect", () => {
      redis.get("foo", function (err) {
        expect(err).to.be(typeof(StreamNotWritable));
        done();
      });
    });
  });

  it("throws for invalid command", async () => {
    const redis = new Redis();
    const invalidCommand = "áéűáű";
    let err;
    try {
      await redis.call(invalidCommand, []);
    } catch (e) {
      err = e.message;
    }
    expect(err).to.contain("unknown command");
    expect(err).to.contain(invalidCommand);
  });
});
