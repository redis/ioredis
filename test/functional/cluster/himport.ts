import { expect } from "chai";
import { Socket } from "net";
import { Cluster } from "../../../lib";
import MockServer from "../../helpers/mock_server";

interface ReceivedCommand {
  port: number;
  argv: string[];
}

describe("cluster:himport", () => {
  const masterOne = 30301;
  const masterTwo = 30302;
  const replica = 30303;
  const slotTable = [
    [0, 8191, ["127.0.0.1", masterOne], ["127.0.0.1", replica]],
    [8192, 16383, ["127.0.0.1", masterTwo]],
  ];
  let cluster: Cluster;

  afterEach(() => {
    cluster?.disconnect();
  });

  function setup(
    handler?: (
      argv: string[],
      port: number,
      socket: Socket,
      flags: { hang?: boolean },
      server: MockServer
    ) => unknown
  ) {
    const received: ReceivedCommand[] = [];

    for (const port of [masterOne, masterTwo, replica]) {
      let server: MockServer;
      server = new MockServer(port, (argv, socket, flags) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return slotTable;
        }
        if (argv[0] === "himport" || argv[0] === "asking") {
          received.push({ port, argv });
        }
        return handler?.(argv, port, socket, flags, server);
      });
    }

    return received;
  }

  function createCluster(options = {}) {
    cluster = new Cluster([{ host: "127.0.0.1", port: masterOne }], {
      enableReadyCheck: false,
      redisOptions: {
        protocol: 2,
        enableReadyCheck: false,
      },
      ...options,
    });
  }

  function commands(
    received: ReceivedCommand[],
    port: number,
    subcommand?: string
  ): ReceivedCommand[] {
    return received.filter(
      ({ port: commandPort, argv }) =>
        commandPort === port &&
        argv[0] === "himport" &&
        (!subcommand || argv[1] === subcommand)
    );
  }

  it("fans manual control commands out to masters only", async () => {
    const received = setup();
    createCluster();

    expect(await cluster.himport("PREPARE", "batch", "a", "b")).to.equal("OK");
    expect(commands(received, masterOne, "PREPARE")).to.have.lengthOf(1);
    expect(commands(received, masterTwo, "PREPARE")).to.have.lengthOf(1);
    expect(commands(received, replica)).to.have.lengthOf(0);
  });

  it("waits for all manual control replies and returns the first", async () => {
    const received = setup((argv, port) => {
      if (argv[0] === "himport" && argv[1] === "DISCARD") {
        return port === masterOne ? 1 : 0;
      }
    });
    createCluster();

    expect(await cluster.himport("DISCARD", "batch")).to.equal(1);
    expect(commands(received, masterOne, "DISCARD")).to.have.lengthOf(1);
    expect(commands(received, masterTwo, "DISCARD")).to.have.lengthOf(1);
  });

  it("rejects a manual control command when one master fails", async () => {
    setup((argv, port) => {
      if (
        argv[0] === "himport" &&
        argv[1] === "PREPARE" &&
        port === masterTwo
      ) {
        return new Error("ERR prepare failed");
      }
    });
    createCluster();

    let error: Error | undefined;
    try {
      await cluster.himport("PREPARE", "batch", "field");
    } catch (receivedError) {
      error = receivedError as Error;
    }

    expect(error?.message).to.equal("ERR prepare failed");
  });

  it("prepares configured fieldsets on each connected master", async () => {
    const received = setup();
    createCluster({
      himportFieldsets: [{ name: "configured", fields: ["a", "b"] }],
    });

    await cluster.set("foo", "value");
    await cluster.set("bar", "value");
    expect(
      await cluster.himport("SET", "foo", "configured", "1", "2")
    ).to.equal("OK");

    expect(commands(received, masterOne, "PREPARE")).to.have.lengthOf(1);
    expect(commands(received, masterTwo, "PREPARE")).to.have.lengthOf(1);
    expect(commands(received, replica)).to.have.lengthOf(0);
  });

  it("recovers a configured SET on the selected master", async () => {
    let setAttempts = 0;
    const received = setup((argv, port) => {
      if (port === masterTwo && argv[0] === "himport" && argv[1] === "SET") {
        setAttempts += 1;
        if (setAttempts === 1) {
          return new Error("ERR no such fieldset");
        }
      }
    });
    createCluster({
      himportFieldsets: [{ name: "configured", fields: ["field"] }],
    });

    expect(await cluster.himport("SET", "foo", "configured", "value")).to.equal(
      "OK"
    );

    expect(setAttempts).to.equal(2);
    expect(commands(received, masterTwo, "PREPARE")).to.have.lengthOf(2);
  });

  it("prepares an ASK target before ASKING and SET", async () => {
    let redirected = false;
    const received = setup((argv, port) => {
      if (
        !redirected &&
        port === masterOne &&
        argv[0] === "himport" &&
        argv[1] === "SET"
      ) {
        redirected = true;
        return new Error(`ASK 5061 127.0.0.1:${masterTwo}`);
      }
    });
    createCluster({
      himportFieldsets: [{ name: "configured", fields: ["field"] }],
    });

    expect(await cluster.himport("SET", "bar", "configured", "value")).to.equal(
      "OK"
    );

    expect(
      received
        .filter(({ port }) => port === masterTwo)
        .map(({ argv }) => argv.slice(0, 2))
    ).to.deep.equal([["himport", "PREPARE"], ["asking"], ["himport", "SET"]]);
  });

  it("does not send to an ASK target after the command times out", async () => {
    let redirected = false;
    const received = setup((argv, port, socket, flags, server) => {
      if (
        !redirected &&
        port === masterOne &&
        argv[0] === "himport" &&
        argv[1] === "SET"
      ) {
        redirected = true;
        flags.hang = true;
        setTimeout(
          () =>
            server.write(socket, new Error(`ASK 5061 127.0.0.1:${masterTwo}`)),
          50
        );
      }
      if (
        port === masterTwo &&
        argv[0] === "himport" &&
        argv[1] === "PREPARE"
      ) {
        flags.hang = true;
        setTimeout(() => server.write(socket, "OK"), 60);
      }
    });
    createCluster({
      himportFieldsets: [{ name: "configured", fields: ["field"] }],
      redisOptions: {
        protocol: 2,
        enableReadyCheck: false,
        commandTimeout: 80,
      },
    });

    let error: Error | undefined;
    try {
      await cluster.himport("SET", "bar", "configured", "value");
    } catch (receivedError) {
      error = receivedError as Error;
    }

    expect(error?.message).to.equal("Command timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(commands(received, masterTwo, "SET")).to.have.lengthOf(0);
    expect(
      received.filter(
        ({ port, argv }) => port === masterTwo && argv[0] === "asking"
      )
    ).to.have.lengthOf(0);
  });

  it("prepares a promoted replica before its first configured write", async () => {
    const received = setup();
    createCluster({
      himportFieldsets: [{ name: "configured", fields: ["field"] }],
    });

    await cluster.set("bar", "value");
    expect(commands(received, replica)).to.have.lengthOf(0);

    slotTable[0] = [0, 8191, ["127.0.0.1", replica], ["127.0.0.1", masterOne]];

    try {
      const prepared = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Timed out waiting for promoted master")),
          1_000
        );
        const check = setInterval(() => {
          if (commands(received, replica, "PREPARE").length) {
            clearInterval(check);
            clearTimeout(timeout);
            resolve();
          }
        }, 10);
      });

      cluster.refreshSlotsCache();
      await prepared;
      expect(commands(received, replica, "PREPARE")).to.have.lengthOf(1);

      expect(
        await cluster.himport("SET", "bar", "configured", "value")
      ).to.equal("OK");
      expect(commands(received, replica, "PREPARE")).to.have.lengthOf(1);
    } finally {
      slotTable[0] = [
        0,
        8191,
        ["127.0.0.1", masterOne],
        ["127.0.0.1", replica],
      ];
    }
  });

  it("keeps explicit pipelines connection-affine and unmanaged", async () => {
    const received = setup();
    createCluster();

    const result = await cluster
      .pipeline()
      .himport("PREPARE", "batch", "field")
      .himport("SET", "foo", "batch", "value")
      .himport("DISCARD", "batch")
      .exec();

    expect(result).to.deep.equal([
      [null, "OK"],
      [null, "OK"],
      [null, "OK"],
    ]);
    expect(commands(received, masterOne)).to.have.lengthOf(0);
    expect(commands(received, masterTwo)).to.have.lengthOf(3);
  });
});
