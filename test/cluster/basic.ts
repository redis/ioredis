import { expect } from "chai";
import Redis, { Cluster } from "../../lib";

const masters = [30000, 30001, 30002];
const replicas = [30003, 30004, 30005];

async function cleanup() {
  for (const port of masters) {
    const redis = new Redis(port);
    await redis.flushall();
    await redis.script("FLUSH");
  }
  // Wait for replication
  await new Promise((resolve) => setTimeout(resolve, 500));
}

describe("cluster", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("discovers nodes from master", async () => {
    const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);
    await cluster.set("foo", "bar");
    expect(await cluster.get("foo")).to.eql("bar");
  });

  it("discovers nodes from replica", async () => {
    const cluster = new Cluster([{ host: "127.0.0.1", port: replicas[0] }]);
    await cluster.set("foo", "bar");
    expect(await cluster.get("foo")).to.eql("bar");
  });

  describe("#nodes()", () => {
    it("returns master nodes", async () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);
      await cluster.info();
      const nodes = cluster.nodes("master");
      expect(nodes.map((node) => node.options.port).sort()).to.eql(masters);
    });

    it("returns replica nodes", async () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);
      await cluster.info();
      const nodes = cluster.nodes("slave");
      expect(nodes.map((node) => node.options.port).sort()).to.eql(replicas);
    });

    it("returns all nodes", async () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);
      await cluster.info();
      const nodes = cluster.nodes();
      expect(nodes.map((node) => node.options.port).sort()).to.eql(
        masters.concat(replicas)
      );
    });
  });

  describe("scaleReads", () => {
    it("ensures non-readonly commands still working", async () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }], {
        scaleReads: "slave",
      });
      await cluster.set("foo", "bar");
      expect(await cluster.get("foo")).to.eql("bar");
    });
  });

  describe("pipeline", () => {
    it("ensures script ordering when not loaded", async () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);
      cluster.defineCommand("myget", {
        numberOfKeys: 1,
        lua: "return redis.call('GET', KEYS[1])",
      });

      expect(
        await cluster
          .pipeline()
          // @ts-expect-error
          .myget("foo")
          .set("foo", "setAfterMyGET")
          .myget("foo")
          .exec()
      ).to.eql([
        [null, null],
        [null, "OK"],
        [null, "setAfterMyGET"],
      ]);
    });

    it("falls back to eval when the cache is flushed", async () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);
      cluster.defineCommand("myget", {
        numberOfKeys: 1,
        lua: "return redis.call('GET', KEYS[1])",
      });

      // @ts-expect-error
      await cluster.myget("foo");

      for (const node of cluster.nodes("master")) {
        await node.script("FLUSH");
      }

      expect(
        await cluster
          .pipeline()
          // @ts-expect-error
          .myget("foo")
          .set("foo", "setAfterMyGET")
          .myget("foo")
          .exec()
      ).to.eql([
        [null, "setAfterMyGET"],
        [null, "OK"],
        [null, "setAfterMyGET"],
      ]);
    });
  });

  describe("auto pipelining", () => {
    it("works", async () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }], {
        enableAutoPipelining: true,
      });

      cluster.set("foo", "auto pipelining");
      expect(await cluster.get("foo")).to.eql("auto pipelining");
    });
  });

  describe("key prefixing", () => {
    it("works when passing via redisOptions", async () => {
      const cluster1 = new Cluster([{ host: "127.0.0.1", port: masters[0] }], {
        redisOptions: { keyPrefix: "prefix:" },
      });
      await cluster1.set("foo", "bar");
      const cluster2 = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);
      expect(await cluster2.get("prefix:foo")).to.eql("bar");
    });

    it("works when passing via root", async () => {
      const cluster1 = new Cluster([{ host: "127.0.0.1", port: masters[0] }], {
        keyPrefix: "prefix:",
      });
      await cluster1.set("foo", "bar");
      const cluster2 = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);
      expect(await cluster2.get("prefix:foo")).to.eql("bar");
    });
  });
});
