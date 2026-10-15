import { expect } from "chai";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

describe("sensitive command arguments in errors", () => {
  it("should redact the credentials of a failed AUTH", async () => {
    const redis = new Redis();
    try {
      await redis.auth("no-such-user", "secret");
      expect.fail("AUTH should have failed");
    } catch (err) {
      expect(err.message).to.match(/WRONGPASS/);
      expect(err.command).to.eql({
        name: "auth",
        args: ["[REDACTED]", "[REDACTED]"],
      });
    } finally {
      redis.disconnect();
    }
  });

  it("should redact the credentials of a failed HELLO", async () => {
    const redis = new Redis();
    try {
      await redis.call("hello", "3", "AUTH", "no-such-user", "secret");
      expect.fail("HELLO should have failed");
    } catch (err) {
      expect(err.message).to.match(/WRONGPASS/);
      expect(err.command).to.eql({
        name: "hello",
        args: ["3", "AUTH", "[REDACTED]", "[REDACTED]"],
      });
    } finally {
      redis.disconnect();
    }
  });

  it("should redact the password rules of a failed ACL SETUSER", async () => {
    const redis = new Redis();
    try {
      await redis.acl("SETUSER", "ioredis-test-user", ">secret", "not-a-rule");
      expect.fail("ACL SETUSER should have failed");
    } catch (err) {
      expect(err.command).to.eql({
        name: "acl",
        args: ["SETUSER", "ioredis-test-user", "[REDACTED]", "not-a-rule"],
      });
    } finally {
      await redis.acl("DELUSER", "ioredis-test-user");
      redis.disconnect();
    }
  });

  it("should redact the values of a failed CONFIG SET", async () => {
    const redis = new Redis();
    try {
      await redis.config("SET", "no-such-parameter", "secret");
      expect.fail("CONFIG SET should have failed");
    } catch (err) {
      expect(err.command).to.eql({
        name: "config",
        args: ["SET", "no-such-parameter", "[REDACTED]"],
      });
    } finally {
      redis.disconnect();
    }
  });

  it("should redact the credentials of an AUTH aborted by a connection close", (done) => {
    new MockServer(30001, (argv, _socket, flags) => {
      if (argv[0] === "auth") {
        flags.hang = true;
      }
    });
    const redis = new Redis({
      port: 30001,
      autoResendUnfulfilledCommands: false,
    });
    redis.once("ready", () => {
      redis.auth("user", "secret").then(
        () => done(new Error("AUTH should not have resolved")),
        (err) => {
          try {
            expect(err.name).to.eql("AbortError");
            expect(err.command).to.eql({
              name: "auth",
              args: ["[REDACTED]", "[REDACTED]"],
            });
            redis.disconnect();
            done();
          } catch (assertionError) {
            redis.disconnect();
            done(assertionError);
          }
        }
      );
      setTimeout(() => redis.stream.destroy(), 50);
    });
  });
});
