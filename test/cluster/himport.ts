import { expect } from "chai";
import Redis, { Cluster } from "../../lib";

const masters = [3000, 3001, 3002];

async function cleanup() {
  for (const port of masters) {
    const redis = new Redis(port);
    await redis.flushall();
    await redis.quit();
  }
}

async function clusterSupportsHimport(): Promise<boolean> {
  const redis = new Redis(masters[0]);
  try {
    const reply = (await redis.command("INFO", "himport")) as unknown[];
    return Boolean(reply && reply[0]);
  } finally {
    redis.disconnect();
  }
}

describe("cluster:himport", function () {
  before(async function () {
    if (!(await clusterSupportsHimport())) {
      this.skip();
    }
  });

  beforeEach(cleanup);
  afterEach(cleanup);

  it("prepares on all masters and routes SET by key slot", async () => {
    const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);

    expect(await cluster.himport("PREPARE", "fs", "f1", "f2")).to.eql("OK");
    // Keys hashing to different slots all find the fieldset on their node.
    for (const key of ["a", "b", "c", "d", "e", "f"]) {
      expect(await cluster.himport("SET", key, "fs", "v1", "v2")).to.eql("OK");
    }
    expect(await cluster.hgetall("a")).to.deep.equal({ f1: "v1", f2: "v2" });

    expect(await cluster.himport("DISCARD", "fs")).to.eql(1);
    let error: Error | undefined;
    try {
      await cluster.himport("SET", "a", "fs", "v1", "v2");
    } catch (err) {
      error = err as Error;
    }
    expect(error?.message).to.match(/no such fieldset/);

    cluster.disconnect();
  });

  it("counts fieldsets in DISCARDALL across masters", async () => {
    const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);

    await cluster.himport("PREPARE", "fs1", "a");
    await cluster.himport("PREPARE", "fs2", "b");
    expect(await cluster.himport("DISCARDALL")).to.eql(2);
    expect(await cluster.himport("DISCARDALL")).to.eql(0);

    cluster.disconnect();
  });

  describe("himportFieldsets option", () => {
    it("serves SETs on every slot without an explicit PREPARE", async () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }], {
        himportFieldsets: [{ name: "boot", fields: ["f1"] }],
      });

      for (const key of ["a", "b", "c", "d", "e", "f"]) {
        expect(await cluster.himport("SET", key, "boot", "v")).to.eql("OK");
      }
      expect(await cluster.hgetall("a")).to.deep.equal({ f1: "v" });

      cluster.disconnect();
    });
  });
});
