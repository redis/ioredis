import Redis from "../../lib/redis";
import { expect } from "chai";

describe("select", function () {
  it("should support auto select", function (done) {
    const redis = new Redis({ db: 2 });
    redis.set("foo", "2");
    redis.select("2");
    redis.get("foo", function (err, res) {
      expect(res).to.eql("2");
      redis.disconnect();
      done();
    });
  });

  it("should resend commands to the correct db", function (done) {
    const redis = new Redis();
    redis.once("ready", function () {
      redis.set("foo", "2", function () {
        redis.stream.destroy();
        redis.select("3");
        redis.set("foo", "3");
        redis.select("0");
        redis.get("foo", function (err, res) {
          expect(res).to.eql("2");
          redis.select("3");
          redis.get("foo", function (err, res) {
            expect(res).to.eql("3");
            redis.disconnect();
            done();
          });
        });
      });
    });
  });

  it("should re-select the current db when reconnect", function (done) {
    const redis = new Redis();

    redis.once("ready", function () {
      redis.set("foo", "bar");
      redis.select(2);
      redis.set("foo", "2", function () {
        redis.stream.destroy();
        redis.get("foo", function (err, res) {
          expect(res).to.eql("2");
          redis.disconnect();
          done();
        });
      });
    });
  });

  it('should emit "select" event when db changes', function (done) {
    const changes = [];
    const redis = new Redis();
    redis.on("select", function (db) {
      changes.push(db);
    });
    redis.select("2", function () {
      expect(changes).to.eql([2]);
      redis.select("4", function () {
        expect(changes).to.eql([2, 4]);
        redis.select("4", function () {
          expect(changes).to.eql([2, 4]);
          redis.disconnect();
          done();
        });
      });
    });
  });

  it("should be sent on the connect event", function (done) {
    const redis = new Redis({ db: 2 });
    const select = redis.select;
    redis.select = function () {
      return select.apply(redis, arguments).then(function () {
        redis.select = select;
        redis.disconnect();
        done();
      });
    };
    redis.on("connect", function () {
      redis.subscribe("anychannel");
    });
  });
});
