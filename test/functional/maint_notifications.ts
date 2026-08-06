import { expect } from "chai";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

const PORT = 30001;

describe("maintenance notification handshake", () => {
  it("registers during the RESP3 handshake", (done) => {
    const commands: string[][] = [];
    new MockServer(PORT, (argv) => {
      commands.push(argv);
    });

    const redis = new Redis({
      port: PORT,
      maintEndpointType: "internal-ip",
    });
    redis.on("ready", () => {
      const registration = commands.find(
        ([command, subcommand]) =>
          command === "client" && subcommand === "MAINT_NOTIFICATIONS"
      );
      expect(registration).to.eql([
        "client",
        "MAINT_NOTIFICATIONS",
        "ON",
        "moving-endpoint-type",
        "internal-ip",
      ]);
      expect(commands[0][0]).to.eql("hello");
      redis.disconnect();
      done();
    });
  });

  it("continues in auto mode when registration is unsupported", (done) => {
    new MockServer(PORT, (argv) => {
      if (argv[0] === "client" && argv[1] === "MAINT_NOTIFICATIONS") {
        return new Error("ERR unknown subcommand 'MAINT_NOTIFICATIONS'");
      }
      if (argv[0] === "get") {
        return "bar";
      }
    });

    const redis = new Redis({ port: PORT, maintNotifications: "auto" });
    redis.on("ready", async () => {
      try {
        expect(await redis.get("foo")).to.eql("bar");
        redis.disconnect();
        done();
      } catch (err) {
        redis.disconnect();
        done(err);
      }
    });
  });

  it("surfaces registration failures in enabled mode", (done) => {
    new MockServer(PORT, (argv) => {
      if (argv[0] === "client" && argv[1] === "MAINT_NOTIFICATIONS") {
        return new Error("ERR maintenance notifications unsupported");
      }
    });

    const redis = new Redis({
      port: PORT,
      lazyConnect: true,
      retryStrategy: null,
      maintNotifications: "enabled",
    });
    redis.once("error", (err) => {
      expect(err.message).to.eql("ERR maintenance notifications unsupported");
    });
    redis.once("end", () => done());
    redis.connect().catch(() => {});
  });

  it("does not register when disabled", (done) => {
    const commands: string[][] = [];
    new MockServer(PORT, (argv) => {
      commands.push(argv);
    });

    const redis = new Redis({ port: PORT, maintNotifications: "disabled" });
    redis.on("ready", () => {
      expect(
        commands.some(
          ([command, subcommand]) =>
            command === "client" && subcommand === "MAINT_NOTIFICATIONS"
        )
      ).to.eql(false);
      redis.disconnect();
      done();
    });
  });

  it("does not change the RESP2 handshake", (done) => {
    const commands: string[][] = [];
    new MockServer(PORT, (argv) => {
      commands.push(argv);
    });

    const redis = new Redis({
      port: PORT,
      protocol: 2,
      maintNotifications: "enabled",
    });
    redis.on("ready", () => {
      expect(
        commands.some(
          ([command, subcommand]) =>
            command === "client" && subcommand === "MAINT_NOTIFICATIONS"
        )
      ).to.eql(false);
      redis.disconnect();
      done();
    });
  });
});
