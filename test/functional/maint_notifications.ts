import { expect } from "chai";
import Redis from "../../lib/Redis";
import type MaintenanceManager from "../../lib/maintNotifications/MaintenanceManager";
import MockServer from "../helpers/mock_server";

const PORT = 30001;

const waitFor = async (predicate: () => boolean, timeoutMs = 1000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
};

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

  it("tracks maintenance windows from server pushes", async () => {
    const server = new MockServer(PORT, () => {});
    const redis = new Redis({ port: PORT });
    await new Promise((resolve) => redis.once("ready", resolve));

    const manager = (redis as any)
      .maintenanceManager as MaintenanceManager | null;
    expect(manager).to.not.eql(null);
    expect(manager!.isMaintenanceActive()).to.eql(false);

    server.broadcast(MockServer.raw(">3\r\n$9\r\nMIGRATING\r\n:1\r\n:10\r\n"));
    await waitFor(() => manager!.isMaintenanceActive());

    server.broadcast(MockServer.raw(">2\r\n$8\r\nMIGRATED\r\n:2\r\n"));
    await waitFor(() => !manager!.isMaintenanceActive());

    redis.disconnect();
  });

  it("does not create a manager when disabled", async () => {
    new MockServer(PORT, () => {});
    const redis = new Redis({ port: PORT, maintNotifications: "disabled" });
    await new Promise((resolve) => redis.once("ready", resolve));

    expect((redis as any).maintenanceManager).to.eql(null);

    redis.disconnect();
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
