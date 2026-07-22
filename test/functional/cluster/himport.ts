import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";

interface ReceivedCommand {
  port: number;
  argv: string[];
}

describe("cluster:himport", () => {
  // 30001 and 30002 are masters, 30003 is a replica of 30001.
  const slotTable = [
    [0, 8191, ["127.0.0.1", 30001], ["127.0.0.1", 30003]],
    [8192, 16383, ["127.0.0.1", 30002]],
  ];

  function setup(handler?: (argv: string[], port: number) => any) {
    const received: ReceivedCommand[] = [];
    for (const port of [30001, 30002, 30003]) {
      new MockServer(port, (argv) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return slotTable;
        }
        if (argv[0] === "himport") {
          received.push({ port, argv });
        }
        return handler?.(argv, port);
      });
    }
    return received;
  }

  function himportCommands(
    received: ReceivedCommand[],
    port: number,
    subcommand?: string
  ): ReceivedCommand[] {
    return received.filter(
      ({ port: p, argv }) =>
        p === port && (!subcommand || argv[1] === subcommand)
    );
  }

  it("fans out PREPARE to all masters and no replicas", async () => {
    const received = setup();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    expect(await cluster.himport("PREPARE", "fs", "f1", "f2")).to.eql("OK");
    expect(himportCommands(received, 30001)).to.have.lengthOf(1);
    expect(himportCommands(received, 30002)).to.have.lengthOf(1);
    expect(himportCommands(received, 30003)).to.have.lengthOf(0);
    expect(received[0].argv).to.deep.equal([
      "himport",
      "PREPARE",
      "fs",
      "f1",
      "f2",
    ]);

    cluster.disconnect();
  });

  it("fans out DISCARD and returns a single aggregated reply", async () => {
    const received = setup((argv) => {
      if (argv[0] === "himport" && argv[1] === "DISCARD") {
        return 1;
      }
    });
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    expect(await cluster.himport("DISCARD", "fs")).to.eql(1);
    expect(himportCommands(received, 30001, "DISCARD")).to.have.lengthOf(1);
    expect(himportCommands(received, 30002, "DISCARD")).to.have.lengthOf(1);
    expect(himportCommands(received, 30003)).to.have.lengthOf(0);

    cluster.disconnect();
  });

  it("rejects the fan-out when a master fails", async () => {
    setup((argv, port) => {
      if (argv[0] === "himport" && port === 30002) {
        return new Error("ERR something went wrong");
      }
    });
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    let error: Error | undefined;
    try {
      await cluster.himport("PREPARE", "fs", "f1");
    } catch (err) {
      error = err as Error;
    }
    expect(error?.message).to.match(/something went wrong/);

    cluster.disconnect();
  });

  it("routes SET by the hash slot of its key", async () => {
    const received = setup();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    // calculateSlot("foo") === 12182 -> 30002
    expect(await cluster.himport("SET", "foo", "fs", "v1")).to.eql("OK");
    expect(himportCommands(received, 30001)).to.have.lengthOf(0);
    expect(himportCommands(received, 30002)).to.have.lengthOf(1);
    expect(received[0].argv).to.deep.equal([
      "himport",
      "SET",
      "foo",
      "fs",
      "v1",
    ]);

    cluster.disconnect();
  });

  it("does not fan out all_shards commands with unimplemented response policies", async () => {
    // DBSIZE advertises request_policy:all_shards with response_policy:
    // agg_sum, which the executor doesn't implement — it must keep its
    // default single-node routing instead of being fanned out with the
    // wrong aggregation.
    const calls: number[] = [];
    setup((argv, port) => {
      if (argv[0] === "dbsize") {
        calls.push(port);
        return 42;
      }
    });
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    expect(await cluster.dbsize()).to.eql(42);
    expect(calls).to.have.lengthOf(1);

    cluster.disconnect();
  });

  it("does not fan out no-response-policy commands with non-uniform replies", async () => {
    // KEYS advertises request_policy:all_shards and no response policy, but
    // its per-node replies differ (each node returns its own keys), so the
    // default identical-replies fan-out handling must not apply.
    const calls: number[] = [];
    setup((argv, port) => {
      if (argv[0] === "keys") {
        calls.push(port);
        return ["k1"];
      }
    });
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    expect(await cluster.keys("*")).to.deep.equal(["k1"]);
    expect(calls).to.have.lengthOf(1);

    cluster.disconnect();
  });

  it("executes pipelined himport commands on a single node", async () => {
    const received = setup();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    const results = await cluster
      .pipeline()
      .himport("PREPARE", "fs", "f1")
      .himport("SET", "foo", "fs", "v1")
      .exec();
    expect(results).to.deep.equal([
      [null, "OK"],
      [null, "OK"],
    ]);
    // Both commands land on the node serving the slot of "foo" (30002):
    // pipelines pin session-scoped sequences to one connection, no fan-out.
    expect(himportCommands(received, 30001)).to.have.lengthOf(0);
    expect(himportCommands(received, 30002)).to.have.lengthOf(2);
    expect(himportCommands(received, 30003)).to.have.lengthOf(0);

    cluster.disconnect();
  });

  describe("himportFieldsets option", () => {
    it("prepares fieldsets on master connections during the handshake", async () => {
      const received = setup();
      const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
        himportFieldsets: [{ name: "boot", fields: ["f1", "f2"] }],
      });

      // Force both master connections to establish.
      await cluster.set("foo", "bar"); // slot 12182 -> 30002
      await cluster.set("bar", "baz"); // slot 5061 -> 30001

      expect(himportCommands(received, 30001, "PREPARE")).to.have.lengthOf(1);
      expect(himportCommands(received, 30002, "PREPARE")).to.have.lengthOf(1);
      expect(himportCommands(received, 30003)).to.have.lengthOf(0);
      expect(received[0].argv).to.deep.equal([
        "himport",
        "PREPARE",
        "boot",
        "f1",
        "f2",
      ]);

      cluster.disconnect();
    });

    it("prepares fieldsets on a replica promoted to master", async () => {
      const received = setup();
      const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
        himportFieldsets: [{ name: "boot", fields: ["f1"] }],
      });
      await cluster.set("bar", "baz"); // connect 30001

      expect(himportCommands(received, 30003)).to.have.lengthOf(0);

      // Promote the replica: 30003 now serves the first slot range.
      slotTable[0] = [0, 8191, ["127.0.0.1", 30003], ["127.0.0.1", 30001]];
      const prepared = new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (himportCommands(received, 30003, "PREPARE").length) {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });
      cluster.refreshSlotsCache();
      await prepared;

      cluster.disconnect();
      // Restore for other tests.
      slotTable[0] = [0, 8191, ["127.0.0.1", 30001], ["127.0.0.1", 30003]];
    });
  });
});
