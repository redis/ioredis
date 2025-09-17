import * as sinon from "sinon";
import Redis from "../../lib/redis";
import { expect } from "chai";

describe("spub/ssub", function () {
  it("should invoke the callback when subscribe successfully", (done) => {
    const redis = new Redis();
    let pending = 1;
    redis.ssubscribe("foo", "bar", function (err, count) {
      expect(count).to.eql(2);
      pending -= 1;
    });
    redis.ssubscribe("foo", "zoo", function (err, count) {
      expect(count).to.eql(3);
      expect(pending).to.eql(0);
      redis.disconnect();
      done();
    });
  });

  it("should reject when issue a command in the subscriber mode", (done) => {
    const redis = new Redis();
    redis.ssubscribe("foo", function () {
      redis.set("foo", "bar", function (err) {
        expect(err instanceof Error);
        expect(err.message).to.match(/subscriber mode/);
        redis.disconnect();
        done();
      });
    });
  });

  it("should report being in 'subscriber' mode when subscribed", (done) => {
    const redis = new Redis();
    redis.ssubscribe("foo", function () {
      expect(redis.mode).to.equal("subscriber");
      redis.disconnect();
      done();
    });
  });

  it("should exit subscriber mode using sunsubscribe", (done) => {
    const redis = new Redis();
    redis.ssubscribe("foo", "bar", function () {
      redis.sunsubscribe("foo", "bar", function (err, count) {
        expect(count).to.eql(0);
        redis.set("foo", "bar", function (err) {
          expect(err).to.eql(null);

          redis.ssubscribe("zoo", "foo", function () {
            redis.sunsubscribe(function (err, count) {
              expect(count).to.eql(0);
              redis.set("foo", "bar", function (err) {
                expect(err).to.eql(null);
                redis.disconnect();
                done();
              });
            });
          });
        });
      });
    });
  });

  it("should report being in 'normal' mode after sunsubscribing", (done) => {
    const redis = new Redis();
    redis.ssubscribe("foo", "bar", function () {
      redis.sunsubscribe("foo", "bar", function (err, count) {
        expect(redis.mode).to.equal("normal");
        redis.disconnect();
        done();
      });
    });
  });

  it("should receive messages when subscribe a shard channel", (done) => {
    const redis = new Redis();
    const pub = new Redis();
    let pending = 2;
    redis.ssubscribe("foo", function () {
      pub.spublish("foo", "bar");
    });
    redis.on("smessage", function (channel, message) {
      expect(channel).to.eql("foo");
      expect(message).to.eql("bar");
      if (!--pending) {
        redis.disconnect();
        done();
      }
    });
    redis.on("smessageBuffer", function (channel, message) {
      expect(channel).to.be.instanceof(Buffer);
      expect(channel.toString()).to.eql("foo");
      expect(message).to.be.instanceof(Buffer);
      expect(message.toString()).to.eql("bar");
      if (!--pending) {
        redis.disconnect();
        done();
      }
    });
  });

  it("should be able to send quit command in the subscriber mode", (done) => {
    const redis = new Redis();
    let pending = 1;
    redis.ssubscribe("foo", function () {
      redis.quit(function () {
        pending -= 1;
      });
    });
    redis.on("end", function () {
      expect(pending).to.eql(0);
      redis.disconnect();
      done();
    });
  });

  // TODO ready reconnect in redis stand
  it("should restore subscription after reconnecting(ssubscribe)", (done) => {
    const redis = new Redis({ port: 6379, host: "127.0.0.1" });
    const pub = new Redis({ port: 6379, host: "127.0.0.1" });
    // redis.ping(function (err, result) {
    //   // redis.on("message", function (channel, message) {
    //   console.log(`${err}-${result}`);
    //   // });
    // });
    redis.ssubscribe("foo", "bar", function () {
      redis.on("ready", function () {
        // Execute a random command to make sure that `subscribe`
        // is sent
        redis.ping(function () {
          let pending = 2;
          redis.on("smessage", function (channel, message) {
            if (!--pending) {
              redis.disconnect();
              pub.disconnect();
              done();
            }
          });
          pub.spublish("foo", "hi1");
          pub.spublish("bar", "hi2");
        });
      });
      redis.disconnect(true);
    });
  });

  // This ensures we don't get CROSSSLOT exceptions
  it("should call ssubscribe individually for each channel during auto-resubscription", async () => {
    const subscriber = new Redis({ autoResubscribe: true });

    await subscriber.ping();

    subscriber.ssubscribe("shard1");
    subscriber.ssubscribe("shard2");
    subscriber.ssubscribe("shard3");

    const stub = sinon.stub(Redis.prototype, "ssubscribe");

    subscriber.disconnect({ reconnect: true });

    await new Promise((resolve) => {
      subscriber.once("ready", resolve);
    });

    await subscriber.ping();

    expect(stub.getCall(0).args).to.deep.equal(["shard1"]);
    expect(stub.getCall(1).args).to.deep.equal(["shard2"]);
    expect(stub.getCall(2).args).to.deep.equal(["shard3"]);

    stub.restore();
    subscriber.disconnect();
  });
});
