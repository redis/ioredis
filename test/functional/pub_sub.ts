import Redis from "../../lib/Redis";
import { expect } from "chai";

describe("pub/sub", function () {
  it("should invoke the callback when subscribe successfully", (done) => {
    const redis = new Redis();
    let pending = 1;
    redis.subscribe("foo", "bar", function (err, count) {
      expect(count).to.eql(2);
      pending -= 1;
    });
    redis.subscribe("foo", "zoo", function (err, count) {
      expect(count).to.eql(3);
      expect(pending).to.eql(0);
      redis.disconnect();
      done();
    });
  });

  it("should reject when issue a command in the subscriber mode", (done) => {
    const redis = new Redis();
    redis.subscribe("foo", function () {
      redis.set("foo", "bar", function (err) {
        expect(err instanceof Error);
        expect(err.message).to.match(/subscriber mode/);
        redis.disconnect();
        done();
      });
    });
  });

  it("should exit subscriber mode using unsubscribe", (done) => {
    const redis = new Redis();
    redis.subscribe("foo", "bar", function () {
      redis.unsubscribe("foo", "bar", function (err, count) {
        expect(count).to.eql(0);
        redis.set("foo", "bar", function (err) {
          expect(err).to.eql(null);

          redis.subscribe("zoo", "foo", function () {
            redis.unsubscribe(function (err, count) {
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

  it("should receive messages when subscribe a channel", (done) => {
    const redis = new Redis();
    const pub = new Redis();
    let pending = 2;
    redis.subscribe("foo", function () {
      pub.publish("foo", "bar");
    });
    redis.on("message", function (channel, message) {
      expect(channel).to.eql("foo");
      expect(message).to.eql("bar");
      if (!--pending) {
        redis.disconnect();
        done();
      }
    });
    redis.on("messageBuffer", function (channel, message) {
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

  it("should receive messages when psubscribe a pattern", (done) => {
    const redis = new Redis();
    const pub = new Redis();
    let pending = 2;
    redis.psubscribe("f?oo", function () {
      pub.publish("fzoo", "bar");
    });
    redis.on("pmessage", function (pattern, channel, message) {
      expect(pattern).to.eql("f?oo");
      expect(channel).to.eql("fzoo");
      expect(message).to.eql("bar");
      if (!--pending) {
        redis.disconnect();
        pub.disconnect();
        done();
      }
    });
    redis.on("pmessageBuffer", function (pattern, channel, message) {
      expect(pattern).to.eql("f?oo");
      expect(channel).to.be.instanceof(Buffer);
      expect(channel.toString()).to.eql("fzoo");
      expect(message).to.be.instanceof(Buffer);
      expect(message.toString()).to.eql("bar");
      if (!--pending) {
        redis.disconnect();
        pub.disconnect();
        done();
      }
    });
  });

  it("should exit subscriber mode using punsubscribe", async () => {
    const redis = new Redis();
    await redis.psubscribe("f?oo", "b?ar");
    const count = await redis.punsubscribe("f?oo", "b?ar");
    expect(count).to.eql(0);

    await redis.set("foo", "bar");
    await redis.psubscribe("z?oo", "f?oo");
    const newCount = await redis.punsubscribe();
    expect(newCount).to.eql(0);
    await redis.set("foo", "bar");
    redis.disconnect();
  });

  it("should be able to send quit command in the subscriber mode", (done) => {
    const redis = new Redis();
    let pending = 1;
    redis.subscribe("foo", function () {
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

  it("should restore subscription after reconnecting(subscribe)", (done) => {
    const redis = new Redis();
    const pub = new Redis();
    redis.subscribe("foo", "bar", function () {
      redis.on("ready", function () {
        // Execute a random command to make sure that `subscribe`
        // is sent
        redis.ping(function () {
          let pending = 2;
          redis.on("message", function (channel, message) {
            if (!--pending) {
              redis.disconnect();
              pub.disconnect();
              done();
            }
          });
          pub.publish("foo", "hi1");
          pub.publish("bar", "hi2");
        });
      });
      redis.disconnect(true);
    });
  });

  it("should restore subscription after reconnecting(psubscribe)", (done) => {
    const redis = new Redis();
    const pub = new Redis();
    redis.psubscribe("fo?o", "ba?r", function () {
      redis.on("ready", function () {
        redis.ping(function () {
          let pending = 2;
          redis.on("pmessage", function (pattern, channel, message) {
            if (!--pending) {
              redis.disconnect();
              pub.disconnect();
              done();
            }
          });
          pub.publish("fo1o", "hi1");
          pub.publish("ba1r", "hi2");
        });
      });
      redis.disconnect(true);
    });
  });
});
