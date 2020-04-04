import Redis from "../../lib/redis";
import { expect } from "chai";

describe("transformer", function () {
  describe("default transformer", function () {
    describe("hmset", function () {
      it("should support object", function (done) {
        const redis = new Redis();
        redis.hmset("foo", { a: 1, b: "2" }, function (err, result) {
          expect(result).to.eql("OK");
          redis.hget("foo", "b", function (err, result) {
            expect(result).to.eql("2");
            done();
          });
        });
      });
      it("should support Map", function (done) {
        if (typeof Map === "undefined") {
          return done();
        }
        const redis = new Redis();
        const map = new Map();
        map.set("a", 1);
        map.set("b", "2");
        redis.hmset("foo", map, function (err, result) {
          expect(result).to.eql("OK");
          redis.hget("foo", "b", function (err, result) {
            expect(result).to.eql("2");
            done();
          });
        });
      });
      it("should not affect the old way", function (done) {
        const redis = new Redis();
        redis.hmset("foo", "a", 1, "b", "2", function (err, result) {
          expect(result).to.eql("OK");
          redis.hget("foo", "b", function (err, result) {
            expect(result).to.eql("2");
            done();
          });
        });
      });
    });

    describe("mset", function () {
      it("should support object", function (done) {
        const redis = new Redis();
        redis.mset({ a: 1, b: "2" }, function (err, result) {
          expect(result).to.eql("OK");
          redis.mget("a", "b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
      it("should support Map", function (done) {
        if (typeof Map === "undefined") {
          return done();
        }
        const redis = new Redis();
        const map = new Map();
        map.set("a", 1);
        map.set("b", "2");
        redis.mset(map, function (err, result) {
          expect(result).to.eql("OK");
          redis.mget("a", "b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
      it("should not affect the old way", function (done) {
        const redis = new Redis();
        redis.mset("a", 1, "b", "2", function (err, result) {
          expect(result).to.eql("OK");
          redis.mget("a", "b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
      it("should work with keyPrefix option", function (done) {
        const redis = new Redis({ keyPrefix: "foo:" });
        redis.mset({ a: 1, b: "2" }, function (err, result) {
          expect(result).to.eql("OK");
          const otherRedis = new Redis();
          otherRedis.mget("foo:a", "foo:b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
    });

    describe("msetnx", function () {
      it("should support object", function (done) {
        const redis = new Redis();
        redis.msetnx({ a: 1, b: "2" }, function (err, result) {
          expect(result).to.eql(1);
          redis.mget("a", "b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
      it("should support Map", function (done) {
        if (typeof Map === "undefined") {
          return done();
        }
        const redis = new Redis();
        const map = new Map();
        map.set("a", 1);
        map.set("b", "2");
        redis.msetnx(map, function (err, result) {
          expect(result).to.eql(1);
          redis.mget("a", "b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
      it("should not affect the old way", function (done) {
        const redis = new Redis();
        redis.msetnx("a", 1, "b", "2", function (err, result) {
          expect(result).to.eql(1);
          redis.mget("a", "b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
      it("should work with keyPrefix option", function (done) {
        const redis = new Redis({ keyPrefix: "foo:" });
        redis.msetnx({ a: 1, b: "2" }, function (err, result) {
          expect(result).to.eql(1);
          const otherRedis = new Redis();
          otherRedis.mget("foo:a", "foo:b", function (err, result) {
            expect(result).to.eql(["1", "2"]);
            done();
          });
        });
      });
    });

    describe("hgetall", function () {
      it("should return an object", function (done) {
        const redis = new Redis();
        redis.hmset("foo", "k1", "v1", "k2", "v2", function () {
          redis.hgetall("foo", function (err, result) {
            expect(result).to.eql({ k1: "v1", k2: "v2" });
            done();
          });
        });
      });

      it("should return {} when key not exists", function (done) {
        const redis = new Redis();
        redis.hgetall("foo", function (err, result) {
          expect(result).to.eql({});
          done();
        });
      });
    });

    describe("hset", function () {
      it("should support object", function (done) {
        const redis = new Redis();
        redis.hset("foo", { a: 1, b: "e", c: 123 }, function (err, result) {
          expect(result).to.eql(3);
          redis.hget("foo", "b", function (err, result) {
            expect(result).to.eql("e");
            done();
          });
        });
      });
      it("should support Map", function (done) {
        if (typeof Map === "undefined") {
          return done();
        }
        const redis = new Redis();
        const map = new Map();
        map.set("a", 1);
        map.set("b", "e");
        redis.hset("foo", map, function (err, result) {
          expect(result).to.eql(2);
          redis.hget("foo", "b", function (err, result) {
            expect(result).to.eql("e");
            done();
          });
        });
      });
      it("should affect the old way", function (done) {
        const redis = new Redis();
        redis.hset("foo", "a", 1, "b", "e", function (err, result) {
          expect(result).to.eql(2);
          redis.hget("foo", "b", function (err, result) {
            expect(result).to.eql("e");
            done();
          });
        });
      });
    });
  });
});
