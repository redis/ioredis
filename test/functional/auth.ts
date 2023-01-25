import MockServer from "../helpers/mock_server";
import { expect } from "chai";
import Redis from "../../lib/Redis";
import * as sinon from "sinon";

describe("auth", () => {
  /* General non-Redis-version specific tests */
  it("should send auth before other commands", (done) => {
    let authed = false;
    new MockServer(17379, (argv) => {
      if (argv[0] === "auth" && argv[1] === "pass") {
        authed = true;
      } else if (argv[0] === "get" && argv[1] === "foo") {
        expect(authed).to.eql(true);
        redis.disconnect();
        done();
      }
    });
    const redis = new Redis({ port: 17379, password: "pass" });
    redis.get("foo").catch(() => {});
  });

  it("should resend auth after reconnect", (done) => {
    let begin = false;
    let authed = false;
    new MockServer(17379, (argv) => {
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
    const redis = new Redis({ port: 17379, password: "pass" });
    redis.once("ready", () => {
      begin = true;
      redis.disconnect(true);
      redis.get("foo").catch(() => {});
    });
  });

  describe("auth:redis5-specific", () => {
    it("should handle auth with Redis URL string (redis://:foo@bar.com/) correctly", (done) => {
      const password = "pass";
      let redis;
      new MockServer(17379, (argv) => {
        if (argv[0] === "auth" && argv[1] === password) {
          redis.disconnect();
          done();
        }
      });
      redis = new Redis(`redis://:${password}@localhost:17379/`);
    });

    it('should not emit "error" when the server doesn\'t need auth', (done) => {
      new MockServer(17379, (argv) => {
        if (argv[0] === "auth" && argv[1] === "pass") {
          return new Error("ERR Client sent AUTH, but no password is set");
        }
      });
      let errorEmitted = false;
      const redis = new Redis({ port: 17379, password: "pass" });
      redis.on("error", () => {
        errorEmitted = true;
      });
      const stub = sinon.stub(console, "warn").callsFake((warn) => {
        if (warn.indexOf("but a password was supplied") !== -1) {
          stub.restore();
          setTimeout(() => {
            expect(errorEmitted).to.eql(false);
            redis.disconnect();
            done();
          }, 0);
        }
      });
    });

    it('should emit "error" when the password is wrong', (done) => {
      new MockServer(17379, (argv) => {
        if (argv[0] === "auth" && argv[1] === "pass") {
          return new Error("ERR invalid password");
        }
      });
      const redis = new Redis({ port: 17379, password: "pass" });
      let pending = 2;
      function check() {
        if (!--pending) {
          redis.disconnect();
          done();
        }
      }
      redis.on("error", (error) => {
        expect(error).to.have.property("message", "ERR invalid password");
        check();
      });
      redis.get("foo", function (err, res) {
        expect(err.message).to.eql("ERR invalid password");
        check();
      });
    });

    it('should emit "error" when password is not provided', (done) => {
      new MockServer(17379, (argv) => {
        if (argv[0] === "info") {
          return new Error("NOAUTH Authentication required.");
        }
      });
      const redis = new Redis({ port: 17379 });
      redis.on("error", (error) => {
        expect(error).to.have.property(
          "message",
          "NOAUTH Authentication required."
        );
        redis.disconnect();
        done();
      });
    });

    it('should emit "error" when username and password are set for a Redis 5 server', (done) => {
      let username = "user";
      let password = "password";

      new MockServer(17379, (argv) => {
        if (
          argv[0] === "auth" &&
          argv[1] === username &&
          argv[2] === password
        ) {
          return new Error("ERR wrong number of arguments for 'auth' command");
        }
      });

      const redis = new Redis({ port: 17379, username, password });
      const stub = sinon.stub(console, "warn").callsFake((warn) => {
        if (
          warn.indexOf(
            "You are probably passing both username and password to Redis version 5 or below"
          ) !== -1
        ) {
          stub.restore();
          setTimeout(() => {
            redis.disconnect();
            done();
          }, 0);
        }
      });
    });
  });

  describe("auth:redis6-specific", () => {
    /*Redis 6 specific tests */
    it("should handle username and password auth (Redis >=6) correctly", (done) => {
      let username = "user";
      let password = "pass";
      let redis;
      new MockServer(17379, (argv) => {
        if (
          argv[0] === "auth" &&
          argv[1] === username &&
          argv[2] === password
        ) {
          redis.disconnect();
          done();
        }
      });
      redis = new Redis({ port: 17379, username, password });
    });

    it("should handle auth with Redis URL string with username and password (Redis >=6) (redis://foo:bar@baz.com/) correctly", (done) => {
      let username = "user";
      let password = "pass";
      let redis;
      new MockServer(17379, (argv) => {
        if (
          argv[0] === "auth" &&
          argv[1] === username &&
          argv[2] === password
        ) {
          redis.disconnect();
          done();
        }
      });
      redis = new Redis(
        `redis://user:pass@localhost:17379/?allowUsernameInURI=true`
      );
    });

    it('should not emit "error" when the Redis >=6 server doesn\'t need auth', (done) => {
      new MockServer(17379, (argv) => {
        if (argv[0] === "auth" && argv[1] === "pass") {
          return new Error(
            "ERR AUTH <password> called without any password configured for the default user. Are you sure your configuration is correct?"
          );
        }
      });
      let errorEmited = false;
      const redis = new Redis({ port: 17379, password: "pass" });
      redis.on("error", () => {
        errorEmited = true;
      });
      const stub = sinon.stub(console, "warn").callsFake((warn) => {
        if (warn.indexOf("`default` user does not require a password") !== -1) {
          stub.restore();
          setTimeout(() => {
            expect(errorEmited).to.eql(false);
            redis.disconnect();
            done();
          }, 0);
        }
      });
    });

    it('should emit "error" when passing username but not password to Redis >=6 instance', (done) => {
      let username = "user";
      let password = "pass";
      let redis;
      new MockServer(17379, (argv) => {
        if (argv[0] === "auth") {
          if (argv[1] === username && argv[2] === password) {
            return "OK";
          } else {
            return new Error("WRONGPASS invalid username-password pair");
          }
        }
      });
      redis = new Redis({ port: 17379, username });
      redis.on("error", (error) => {
        expect(error).to.have.property(
          "message",
          "WRONGPASS invalid username-password pair"
        );
        redis.disconnect();
        done();
      });
    });

    it('should emit "error" when the password is wrong', (done) => {
      let username = "user";
      let password = "pass";
      let redis;
      new MockServer(17379, (argv) => {
        if (argv[0] === "auth") {
          if (argv[1] === username && argv[2] === password) {
            return "OK";
          } else {
            return new Error("WRONGPASS invalid username-password pair");
          }
        }
      });
      redis = new Redis({ port: 17379, username, password: "notpass" });
      redis.on("error", (error) => {
        expect(error).to.have.property(
          "message",
          "WRONGPASS invalid username-password pair"
        );
        redis.disconnect();
        done();
      });
    });

    it('should emit "error" when password is required but not provided', (done) => {
      new MockServer(17379, (argv) => {
        if (argv[0] === "info") {
          return new Error("NOAUTH Authentication required.");
        }
      });
      const redis = new Redis({ port: 17379 });
      redis.on("error", (error) => {
        expect(error).to.have.property(
          "message",
          "NOAUTH Authentication required."
        );
        redis.disconnect();
        done();
      });
    });
  });
});
