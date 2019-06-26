import MockServer from "../helpers/mock_server";
import { expect } from "chai";
import Redis from "../../lib/redis";
import * as sinon from "sinon";

describe("auth", function() {
  it("should send auth before other commands", function(done) {
    var authed = false;
    new MockServer(17379, argv => {
      if (argv[0] === "auth" && argv[1] === "pass") {
        authed = true;
      } else if (argv[0] === "get" && argv[1] === "foo") {
        expect(authed).to.eql(true);
        redis.disconnect();
        done();
      }
    });
    var redis = new Redis({ port: 17379, password: "pass" });
    redis.get("foo").catch(function() {});
  });

  it("should resend auth after reconnect", function(done) {
    var begin = false;
    var authed = false;
    new MockServer(17379, function(argv) {
      if (!begin) {
        return;
      }
      if (argv[0] === "auth" && argv[1] === "pass") {
        authed = true;
      } else if (argv[0] === "get" && argv[1] === "foo") {
        expect(authed).to.eql(true);
        redis.disconnect();
        done();
      }
    });
    var redis = new Redis({ port: 17379, password: "pass" });
    redis.once("ready", function() {
      begin = true;
      redis.disconnect({ reconnect: true });
      redis.get("foo").catch(function() {});
    });
  });

  it('should not emit "error" when the server doesn\'t need auth', function(done) {
    var server = new MockServer(17379, function(argv) {
      if (argv[0] === "auth" && argv[1] === "pass") {
        return new Error("ERR Client sent AUTH, but no password is set");
      }
    });
    var errorEmited = false;
    var redis = new Redis({ port: 17379, password: "pass" });
    redis.on("error", function() {
      errorEmited = true;
    });
    const stub = sinon.stub(console, "warn").callsFake(warn => {
      if (warn.indexOf("but a password was supplied") !== -1) {
        stub.restore();
        setTimeout(function() {
          expect(errorEmited).to.eql(false);
          redis.disconnect();
          done();
        }, 0);
      }
    });
  });

  it('should emit "error" when the password is wrong', function(done) {
    new MockServer(17379, function(argv) {
      if (argv[0] === "auth" && argv[1] === "pass") {
        return new Error("ERR invalid password");
      }
    });
    var redis = new Redis({ port: 17379, password: "pass" });
    var pending = 2;
    function check() {
      if (!--pending) {
        redis.disconnect();
        done();
      }
    }
    redis.on("error", function(error) {
      expect(error).to.have.property("message", "ERR invalid password");
      check();
    });
    redis.get("foo", function(err, res) {
      expect(err.message).to.eql("ERR invalid password");
      check();
    });
  });

  it('should emit "error" when password is not provided', function(done) {
    new MockServer(17379, function(argv) {
      if (argv[0] === "info") {
        return new Error("NOAUTH Authentication required.");
      }
    });
    var redis = new Redis({ port: 17379 });
    redis.on("error", function(error) {
      expect(error).to.have.property(
        "message",
        "NOAUTH Authentication required."
      );
      redis.disconnect();
      done();
    });
  });
});
