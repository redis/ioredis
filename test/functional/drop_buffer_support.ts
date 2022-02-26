import Redis from "../../lib/Redis";
import { expect } from "chai";

describe("dropBufferSupport", () => {
  it("should be disabled by default", () => {
    const redis = new Redis({ lazyConnect: true });
    expect(redis.options).to.have.property("dropBufferSupport", false);
  });

  it("should return strings correctly", (done) => {
    const redis = new Redis({ dropBufferSupport: false });
    redis.set("foo", Buffer.from("bar"), function (err, res) {
      expect(err).to.eql(null);
      expect(res).to.eql("OK");
      redis.get("foo", function (err, res) {
        expect(err).to.eql(null);
        expect(res).to.eql("bar");
        redis.disconnect();
        done();
      });
    });
  });

  context("enabled", () => {
    it("should reject the buffer commands", (done) => {
      const redis = new Redis({ dropBufferSupport: true });
      redis.getBuffer("foo", function (err) {
        expect(err.message).to.match(/Buffer methods are not available/);

        redis.callBuffer("get", "foo", function (err) {
          expect(err.message).to.match(/Buffer methods are not available/);
          redis.disconnect();
          done();
        });
      });
    });

    it("should reject the custom buffer commands", (done) => {
      const redis = new Redis({ dropBufferSupport: true });
      redis.defineCommand("geteval", {
        numberOfKeys: 0,
        lua: 'return "string"',
      });
      redis.getevalBuffer(function (err) {
        expect(err.message).to.match(/Buffer methods are not available/);
        redis.disconnect();
        done();
      });
    });

    it("should return strings correctly", (done) => {
      const redis = new Redis({ dropBufferSupport: true });
      redis.set("foo", Buffer.from("bar"), function (err, res) {
        expect(err).to.eql(null);
        expect(res).to.eql("OK");
        redis.get("foo", function (err, res) {
          expect(err).to.eql(null);
          expect(res).to.eql("bar");
          redis.disconnect();
          done();
        });
      });
    });

    it("should return strings for custom commands", (done) => {
      const redis = new Redis({ dropBufferSupport: true });
      redis.defineCommand("geteval", {
        numberOfKeys: 0,
        lua: 'return "string"',
      });
      redis.geteval(function (err, res) {
        expect(err).to.eql(null);
        expect(res).to.eql("string");
        redis.disconnect();
        done();
      });
    });

    it("should work with pipeline", (done) => {
      const redis = new Redis({ dropBufferSupport: true });
      const pipeline = redis.pipeline();
      pipeline.set("foo", "bar");
      pipeline.get(Buffer.from("foo"));
      pipeline.exec(function (err, res) {
        expect(err).to.eql(null);
        expect(res[0][1]).to.eql("OK");
        expect(res[1][1]).to.eql("bar");
        redis.disconnect();
        done();
      });
    });

    it("should work with transaction", (done) => {
      const redis = new Redis({ dropBufferSupport: true });
      redis
        .multi()
        .set("foo", "bar")
        .get("foo")
        .exec(function (err, res) {
          expect(err).to.eql(null);
          expect(res[0][1]).to.eql("OK");
          expect(res[1][1]).to.eql("bar");
          redis.disconnect();
          done();
        });
    });

    it("should fail early with Buffer transaction", (done) => {
      const redis = new Redis({ dropBufferSupport: true });
      redis
        .multi()
        .set("foo", "bar")
        .getBuffer(Buffer.from("foo"), function (err) {
          expect(err.message).to.match(/Buffer methods are not available/);
          redis.disconnect();
          done();
        });
    });

    it("should work with internal select command", (done) => {
      const redis = new Redis({ dropBufferSupport: true, db: 1 });
      const check = new Redis({ db: 1 });
      redis.set("foo", "bar", () => {
        check.get("foo", function (err, res) {
          expect(res).to.eql("bar");
          redis.disconnect();
          check.disconnect();
          done();
        });
      });
    });
  });
});
