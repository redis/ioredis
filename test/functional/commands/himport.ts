import { expect } from "chai";
import { Socket } from "net";
import Redis from "../../../lib/Redis";
import MockServer from "../../helpers/mock_server";

describe("himport", () => {
  const port = 17379;
  let redis: Redis;

  afterEach(() => {
    redis?.disconnect();
  });

  function createRedis(
    handler: (
      argv: string[],
      socket: Socket,
      flags: { hang?: boolean },
      server: MockServer
    ) => unknown,
    fieldsets = [{ name: "fieldset", fields: ["a", "b"] }]
  ): {
    received: string[][];
    errors: Error[];
    getActiveSocket: () => Socket | undefined;
  } {
    const received: string[][] = [];
    const errors: Error[] = [];
    let activeSocket: Socket | undefined;

    let server: MockServer;
    server = new MockServer(port, (argv, socket, flags) => {
      activeSocket = socket;
      received.push(argv);
      return handler(argv, socket, flags, server);
    });

    redis = new Redis({
      host: "127.0.0.1",
      port,
      protocol: 2,
      enableReadyCheck: false,
      lazyConnect: true,
      himportFieldsets: fieldsets,
    });
    redis.on("error", (error) => {
      errors.push(error);
    });

    return {
      received,
      errors,
      getActiveSocket: () => activeSocket,
    };
  }

  it("prepares configured fieldsets during the handshake", async () => {
    const { received } = createRedis(() => undefined);

    await redis.connect();
    expect(
      received.filter((argv) => argv[0] === "himport" && argv[1] === "PREPARE")
    ).to.deep.equal([["himport", "PREPARE", "fieldset", "a", "b"]]);

    expect(await redis.himport("SET", "key:1", "fieldset", "1", "2")).to.equal(
      "OK"
    );
    expect(await redis.himport("SET", "key:2", "fieldset", "3", "4")).to.equal(
      "OK"
    );
    expect(
      received.filter((argv) => argv[0] === "himport" && argv[1] === "PREPARE")
    ).to.have.lengthOf(1);
  });

  it("keeps user HIMPORT commands behind the handshake gate", async () => {
    const { received } = createRedis(() => undefined);

    const connecting = redis.connect();
    const setting = redis.himport(
      "SET",
      "key",
      "fieldset",
      "value-a",
      "value-b"
    );
    await connecting;
    expect(await setting).to.equal("OK");

    expect(
      received
        .filter((argv) => argv[0] === "himport")
        .map((argv) => argv.slice(0, 2))
    ).to.deep.equal([
      ["himport", "PREPARE"],
      ["himport", "SET"],
    ]);
  });

  it("replays configured fieldsets after reconnecting", async () => {
    const { received, getActiveSocket } = createRedis(() => undefined);

    await redis.connect();
    const readyAgain = new Promise<void>((resolve) => {
      redis.once("ready", () => resolve());
    });
    const activeSocket = getActiveSocket();
    expect(activeSocket).to.exist;
    activeSocket?.destroy();
    await readyAgain;

    expect(await redis.himport("SET", "key", "fieldset", "1", "2")).to.equal(
      "OK"
    );
    expect(
      received.filter((argv) => argv[0] === "himport" && argv[1] === "PREPARE")
    ).to.have.lengthOf(2);
  });

  it("keeps the connection usable and rejects dependent SET with PREPARE errors", async () => {
    const rootMessage = "ERR duplicate field name in fieldset";
    const { received, errors } = createRedis((argv) => {
      if (argv[0] === "himport" && argv[1] === "PREPARE") {
        return new Error(rootMessage);
      }
      if (argv[0] === "ping") {
        return "PONG";
      }
    });

    await redis.connect();
    expect(errors).to.have.lengthOf(1);
    expect(errors[0].message).to.equal(rootMessage);
    expect(await redis.ping()).to.equal("PONG");

    let setError: Error | undefined;
    try {
      await redis.himport("SET", "key", "fieldset", "1", "2");
    } catch (error) {
      setError = error as Error;
    }

    expect(setError?.message).to.equal(rootMessage);
    expect(
      received.filter((argv) => argv[0] === "himport" && argv[1] === "PREPARE")
    ).to.have.lengthOf(2);
    expect(
      received.filter((argv) => argv[0] === "himport" && argv[1] === "SET")
    ).to.have.lengthOf(0);
  });

  it("invalidates configured fieldsets when RESET is sent", async () => {
    const { received } = createRedis(() => undefined);

    await redis.connect();
    expect(await redis.reset()).to.equal("OK");
    expect(await redis.himport("SET", "key", "fieldset", "1", "2")).to.equal(
      "OK"
    );

    expect(
      received.filter((argv) => argv[0] === "himport" && argv[1] === "PREPARE")
    ).to.have.lengthOf(2);
  });

  it("prepares configured fieldsets before pipeline SET after RESET", async () => {
    let prepared = false;
    const { received } = createRedis((argv) => {
      if (argv[0] === "himport" && argv[1] === "PREPARE") {
        prepared = true;
      }
      if (argv[0] === "reset") {
        prepared = false;
      }
      if (argv[0] === "himport" && argv[1] === "SET" && !prepared) {
        return new Error("ERR no such fieldset");
      }
    });

    await redis.connect();
    expect(await redis.reset()).to.equal("OK");

    expect(
      await redis.pipeline().himport("SET", "key", "fieldset", "1", "2").exec()
    ).to.deep.equal([[null, "OK"]]);
    expect(
      received
        .filter(
          (argv) =>
            argv[0] === "reset" ||
            (argv[0] === "himport" &&
              (argv[1] === "PREPARE" || argv[1] === "SET"))
        )
        .map((argv) => argv.slice(0, 2))
    ).to.deep.equal([
      ["himport", "PREPARE"],
      ["reset"],
      ["himport", "PREPARE"],
      ["himport", "SET"],
    ]);
  });

  it("recovers once when a configured SET reports a missing fieldset", async () => {
    let setAttempts = 0;
    const { received } = createRedis((argv) => {
      if (argv[0] === "himport" && argv[1] === "SET") {
        setAttempts += 1;
        if (setAttempts === 1) {
          return new Error("ERR no such fieldset");
        }
      }
    });

    await redis.connect();
    expect(await redis.himport("SET", "key", "fieldset", "1", "2")).to.equal(
      "OK"
    );

    expect(setAttempts).to.equal(2);
    expect(
      received.filter((argv) => argv[0] === "himport" && argv[1] === "PREPARE")
    ).to.have.lengthOf(2);
  });

  it("does not retry a configured SET after its command timeout", async () => {
    let prepareAttempts = 0;
    let setAttempts = 0;
    createRedis((argv, socket, flags, server) => {
      if (argv[0] === "himport" && argv[1] === "PREPARE") {
        prepareAttempts += 1;
        if (prepareAttempts === 2) {
          flags.hang = true;
          setTimeout(() => server.write(socket, "OK"), 60);
        }
      }
      if (argv[0] === "himport" && argv[1] === "SET") {
        setAttempts += 1;
        if (setAttempts === 1) {
          flags.hang = true;
          setTimeout(
            () => server.write(socket, new Error("ERR no such fieldset")),
            50
          );
        }
      }
    });

    await redis.connect();
    redis.options.commandTimeout = 80;

    let error: Error | undefined;
    try {
      await redis.himport("SET", "key", "fieldset", "1", "2");
    } catch (receivedError) {
      error = receivedError as Error;
    }

    expect(error?.message).to.equal("Command timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(setAttempts).to.equal(1);
  });

  it("leaves explicit commands for unconfigured fieldsets unmanaged", async () => {
    let unconfiguredPrepareCount = 0;
    const { received } = createRedis((argv) => {
      if (
        argv[0] === "himport" &&
        argv[1] === "PREPARE" &&
        argv[2] === "batch"
      ) {
        unconfiguredPrepareCount += 1;
      }
      if (argv[0] === "himport" && argv[1] === "SET" && argv[3] === "unknown") {
        return new Error("ERR no such fieldset");
      }
    });

    await redis.connect();
    expect(await redis.himport("PREPARE", "batch", "x")).to.equal("OK");
    expect(unconfiguredPrepareCount).to.equal(1);

    let error: Error | undefined;
    try {
      await redis.himport("SET", "key", "unknown", "value");
    } catch (receivedError) {
      error = receivedError as Error;
    }

    expect(error?.message).to.equal("ERR no such fieldset");
    const pipelineResult = await redis
      .pipeline()
      .himport("SET", "pipeline-key", "unknown", "value")
      .exec();
    expect(pipelineResult[0][0]?.message).to.equal("ERR no such fieldset");
    expect(
      received.filter(
        (argv) =>
          argv[0] === "himport" &&
          argv[1] === "PREPARE" &&
          argv[2] === "unknown"
      )
    ).to.have.lengthOf(0);
  });
});
