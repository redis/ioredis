import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";

describe("cluster:missing primary", () => {
  const script = "return redis.call('set', KEYS[1], ARGV[1])";
  const slotTable = [[0, 16383, ["127.0.0.1", 30001], ["127.0.0.1", 30002]]];

  function startNodes() {
    const replicaCommands: string[] = [];
    const primary = new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "eval") {
        return "OK";
      }
      if (argv[0] === "get") {
        return "bar";
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      replicaCommands.push(argv[0]);
      if (argv[0] === "eval") {
        return new Error(
          "READONLY You can't write against a read only replica."
        );
      }
      if (argv[0] === "get") {
        return "bar";
      }
      if (argv[0] === "set") {
        return new Error("MOVED 12182 127.0.0.1:30001");
      }
    });
    return { primary, replicaCommands };
  }

  // Leaves the replica as the only node in the pool.
  async function losePrimary(cluster: Cluster, disconnect: () => void) {
    await cluster.eval(script, 1, "foo", "bar");

    const removed = new Promise((resolve) => cluster.once("-node", resolve));
    disconnect();
    await removed;
  }

  function dropConnections(primary: MockServer) {
    return () => primary.getAllClients().forEach((client) => client.destroy());
  }

  it("should wait for the primary instead of sending a script to a replica", async () => {
    const { primary, replicaCommands } = startNodes();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      retryDelayOnFailover: 1,
    });
    await losePrimary(cluster, dropConnections(primary));

    const reply = await cluster.eval(script, 1, "foo", "bar");

    expect(reply).to.eql("OK");
    expect(replicaCommands).to.not.include("eval");
    expect(cluster.nodes("master")).to.have.lengthOf(1);
    cluster.disconnect();
  });

  it("should wait for the primary instead of sending a pipeline to a replica", async () => {
    const { primary, replicaCommands } = startNodes();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      retryDelayOnFailover: 1,
    });
    await losePrimary(cluster, dropConnections(primary));

    const replies = await cluster
      .pipeline()
      .eval(script, 1, "foo", "bar")
      .exec();

    expect(replies).to.eql([[null, "OK"]]);
    expect(replicaCommands).to.not.include("eval");
    cluster.disconnect();
  });

  it("should retry all of a pipeline that starts with a write when scaleReads allows reads on a replica", async () => {
    const { primary } = startNodes();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      retryDelayOnFailover: 1,
      scaleReads: "slave",
    });
    await losePrimary(cluster, dropConnections(primary));

    const replies = await cluster
      .pipeline()
      .set("foo", "bar")
      .get("foo")
      .exec();

    expect(replies).to.eql([
      [null, "OK"],
      [null, "bar"],
    ]);
    cluster.disconnect();
  });

  it("should reject with the connection error after maxRedirections", async () => {
    const { primary, replicaCommands } = startNodes();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      maxRedirections: 3,
      retryDelayOnFailover: 1,
    });
    await losePrimary(cluster, () => primary.disconnect());

    const error = await cluster.ping().catch((e) => e);

    expect(error.message).to.eql(
      "Too many Cluster redirections. Last error: Error: Connection is closed."
    );
    expect(replicaCommands).to.not.include("ping");
    cluster.disconnect();
  });

  it("should refresh the slots when retryDelayOnFailover is 0", async () => {
    const { primary } = startNodes();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      retryDelayOnFailover: 0,
    });
    await losePrimary(cluster, dropConnections(primary));

    const refreshed = new Promise((resolve) =>
      cluster.once("refresh", resolve)
    );
    const error = await cluster.eval(script, 1, "foo", "bar").catch((e) => e);
    await refreshed;

    expect(error.message).to.eql("Connection is closed.");
    expect(await cluster.eval(script, 1, "foo", "bar")).to.eql("OK");
    cluster.disconnect();
  });

  it("should refresh the slots when maxRedirections is 0", async () => {
    const { primary } = startNodes();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      maxRedirections: 0,
    });
    await losePrimary(cluster, dropConnections(primary));

    const refreshed = new Promise((resolve) =>
      cluster.once("refresh", resolve)
    );
    const error = await cluster.eval(script, 1, "foo", "bar").catch((e) => e);
    await refreshed;

    expect(error.message).to.eql(
      "Too many Cluster redirections. Last error: Error: Connection is closed."
    );
    expect(await cluster.eval(script, 1, "foo", "bar")).to.eql("OK");
    cluster.disconnect();
  });

  it("should still send read-only commands to a replica with scaleReads", async () => {
    const { primary, replicaCommands } = startNodes();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      scaleReads: "slave",
    });
    await losePrimary(cluster, dropConnections(primary));

    const reply = await cluster.get("foo");

    expect(reply).to.eql("bar");
    expect(replicaCommands).to.include("get");
    cluster.disconnect();
  });

  it("should queue a CLUSTER command sent while connecting", async () => {
    startNodes();
    const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }]);

    const reply = await cluster.cluster("INFO");

    expect(reply).to.eql("OK");
    cluster.disconnect();
  });
});
