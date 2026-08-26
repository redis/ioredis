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

  it("derives the endpoint type from the connected peer address", (done) => {
    const commands: string[][] = [];
    new MockServer(PORT, (argv) => {
      commands.push(argv);
    });

    const redis = new Redis({ port: PORT, host: "localhost" });
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

  it("clears maintenance windows when the connection closes", async () => {
    const server = new MockServer(PORT, () => {});
    const redis = new Redis({ port: PORT, retryStrategy: null });
    await new Promise((resolve) => redis.once("ready", resolve));

    const manager = (redis as any).maintenanceManager as MaintenanceManager;
    server.broadcast(MockServer.raw(">3\r\n$9\r\nMIGRATING\r\n:1\r\n:10\r\n"));
    await waitFor(() => manager.isMaintenanceActive());

    redis.disconnect();
    await waitFor(() => !manager.isMaintenanceActive());
  });

  it("relaxes timeouts of new commands during a maintenance window", async () => {
    const server = new MockServer(PORT, (argv, _socket, flags) => {
      if (argv[0] === "get") {
        flags.hang = true;
      }
    });
    const redis = new Redis({
      port: PORT,
      commandTimeout: 100,
      maintRelaxedCommandTimeout: 400,
    });
    await new Promise((resolve) => redis.once("ready", resolve));

    const manager = (redis as any).maintenanceManager as MaintenanceManager;
    server.broadcast(MockServer.raw(">3\r\n$9\r\nMIGRATING\r\n:1\r\n:10\r\n"));
    await waitFor(() => manager.isMaintenanceActive());

    const start = Date.now();
    const err = await redis.get("foo").then(
      () => null,
      (e) => e
    );

    expect(err?.name).to.eql("CommandTimeoutDuringMaintenanceError");
    expect(Date.now() - start).to.be.greaterThan(250);
    redis.disconnect();
  });

  it("extends in-flight command deadlines when a window opens", async () => {
    const server = new MockServer(PORT, (argv, _socket, flags) => {
      if (argv[0] === "get") {
        flags.hang = true;
      }
    });
    const redis = new Redis({
      port: PORT,
      commandTimeout: 150,
      maintRelaxedCommandTimeout: 500,
    });
    await new Promise((resolve) => redis.once("ready", resolve));

    const start = Date.now();
    const pending = redis.get("foo").then(
      () => null,
      (e) => e
    );

    const manager = (redis as any).maintenanceManager as MaintenanceManager;
    server.broadcast(MockServer.raw(">3\r\n$9\r\nMIGRATING\r\n:1\r\n:10\r\n"));
    await waitFor(() => manager.isMaintenanceActive());

    const err = await pending;

    expect(err?.name).to.eql("CommandTimeoutDuringMaintenanceError");
    // Without the extension the command would have been rejected after 150ms.
    expect(Date.now() - start).to.be.greaterThan(350);
    redis.disconnect();
  });

  it("extends resent command deadlines when maintenance starts during reconnect", async () => {
    let connections = 0;
    const server = new MockServer(PORT, (argv, socket, flags) => {
      if (argv[0] === "get") {
        flags.hang = true;
        if (connections === 1) {
          // Drop the connection while the command is unanswered so it moves
          // to prevCommandQueue and is resent after the reconnect.
          setTimeout(() => socket.destroy(), 30);
        }
      }
    });
    server.on("connect", (socket) => {
      connections += 1;
      if (connections === 2) {
        // Maintenance starts while the client is still handshaking, before
        // the carried-over command is resent.
        socket.write(">3\r\n$9\r\nMIGRATING\r\n:1\r\n:10\r\n");
      }
    });

    const redis = new Redis({
      port: PORT,
      commandTimeout: 500,
      maintRelaxedCommandTimeout: 1500,
      retryStrategy: () => 10,
    });
    redis.on("error", () => {});
    await new Promise((resolve) => redis.once("ready", resolve));

    const start = Date.now();
    const err = await redis.get("foo").then(
      () => null,
      (e) => e
    );

    expect(connections).to.eql(2);
    expect(err?.name).to.eql("CommandTimeoutDuringMaintenanceError");
    // Without the extension the command dies at its original 500ms deadline.
    expect(Date.now() - start).to.be.greaterThan(1000);
    redis.disconnect();
  });

  it("keeps relaxed deadlines for in-flight commands resent after a maintenance disconnect", async () => {
    let connections = 0;
    const server = new MockServer(PORT, (argv, socket, flags) => {
      if (argv[0] === "get") {
        flags.hang = true;
        if (connections === 1) {
          // Drop the connection while the relaxed command is unanswered so
          // it is resent after reset() closes the maintenance window.
          setTimeout(() => socket.destroy(), 30);
        }
      }
    });
    server.on("connect", () => {
      connections += 1;
    });

    const redis = new Redis({
      port: PORT,
      commandTimeout: 150,
      maintRelaxedCommandTimeout: 500,
      retryStrategy: () => 10,
    });
    redis.on("error", () => {});
    await new Promise((resolve) => redis.once("ready", resolve));

    const manager = (redis as any).maintenanceManager as MaintenanceManager;
    server.broadcast(MockServer.raw(">3\r\n$9\r\nMIGRATING\r\n:1\r\n:10\r\n"));
    await waitFor(() => manager.isMaintenanceActive());

    const start = Date.now();
    const err = await redis.get("foo").then(
      () => null,
      (e) => e
    );

    expect(connections).to.eql(2);
    expect(manager.isMaintenanceActive()).to.eql(false);
    expect(err?.name).to.eql("CommandTimeoutDuringMaintenanceError");
    // The command was already in flight, so the reconnect must not shorten
    // the relaxed deadline selected for it during maintenance.
    expect(Date.now() - start).to.be.greaterThan(350);
    redis.disconnect();
  });

  it("keeps relaxed deadlines for offline commands issued during maintenance", async () => {
    const server = new MockServer(PORT, (argv, _socket, flags) => {
      if (argv[0] === "get") {
        flags.hang = true;
      }
    });
    const redis = new Redis({
      port: PORT,
      commandTimeout: 150,
      maintRelaxedCommandTimeout: 500,
    });
    await new Promise((resolve) => redis.once("ready", resolve));

    const manager = (redis as any).maintenanceManager as MaintenanceManager;
    server.broadcast(MockServer.raw(">3\r\n$9\r\nMIGRATING\r\n:1\r\n:10\r\n"));
    await waitFor(() => manager.isMaintenanceActive());

    const writePause = manager.pauseWrites();
    const start = Date.now();
    const pending = redis.get("foo").then(
      () => null,
      (e) => e
    );

    server.broadcast(MockServer.raw(">2\r\n$8\r\nMIGRATED\r\n:2\r\n"));
    await waitFor(() => !manager.isMaintenanceActive());
    manager.resumeWrites(writePause);

    const err = await pending;

    // The command was accepted during maintenance, so closing the window
    // before it is flushed must not shorten its relaxed deadline.
    expect(err?.name).to.eql("CommandTimeoutDuringMaintenanceError");
    expect(Date.now() - start).to.be.greaterThan(350);
    redis.disconnect();
  });

  it("uses the relaxed socket timeout during a maintenance window", async () => {
    const server = new MockServer(PORT, (argv, _socket, flags) => {
      if (argv[0] === "get") {
        flags.hang = true;
      }
    });
    const redis = new Redis({
      port: PORT,
      socketTimeout: 100,
      maintRelaxedSocketTimeout: 400,
      retryStrategy: null,
    });
    await new Promise((resolve) => redis.once("ready", resolve));

    const manager = (redis as any).maintenanceManager as MaintenanceManager;
    server.broadcast(MockServer.raw(">3\r\n$9\r\nMIGRATING\r\n:1\r\n:10\r\n"));
    await waitFor(() => manager.isMaintenanceActive());

    const start = Date.now();
    const socketError = new Promise<Error>((resolve) =>
      redis.once("error", resolve)
    );
    redis.get("foo").catch(() => {});

    const err = await socketError;

    expect(err.name).to.eql("SocketTimeoutDuringMaintenanceError");
    expect(Date.now() - start).to.be.greaterThan(250);
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
