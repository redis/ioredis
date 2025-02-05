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


  describe("Test if the client performs the hash-based sharding for simple set operations", () => {
    it("Works when you don't get MOVED error responses", async () => {

      // Verify that the cluster is configured with 3 master nodes
      const cluster : Cluster = new Cluster([{ host: "127.0.0.1", port: masters[0] }]);
      cluster.on("ready", () => {
        expect(cluster.nodes("master").length).to.eql(3);
      });

      const keys = ["channel:test:3", "channel:test:2",  "channel:test:0"]
      for (const k of keys) {
        let status: string = await cluster.set(k, "Test status per node");
        expect(status).to.eql("OK");
        let value: string = await cluster.get(k);
        expect(value).to.eql("Test status per node");
      }
    })
  });

  /**
   * This test is currently failing with a MOVED error. This needs to be fixed.
   */
  describe("sharded publish/subscribe", () => {
    it("works when you can receive published messages to all primary nodes after having subscribed", async () => {
      const host = "127.0.0.1";
      const port: number = masters[0]

      const publisher: Cluster = new Cluster([{ host: host, port: port }]);
      const subscriber: Cluster = new Cluster([{ host: host, port: port }]);

      // Verify that the cluster is configured with 3 master nodes
      publisher.on("ready", () => {
        expect(publisher.nodes("master").length).to.eql(3);
      });

      //0. Construct 3 channel names, whereby the first one is expected to land on node 1, the second one on node 2, and so on
      const channels = ["channel:test:3", "channel:test:2",  "channel:test:0"]

      let total_num_messages = 0;

      for (const c of channels) {
        console.log("Trying to publish to channel:", c);

        //1. Subscribe to the channel
        await subscriber.ssubscribe(c)

        //2. Publish a message before initializing the message handling
        let num_subscribers = await publisher.spublish(c, "This is a test message");
        expect(num_subscribers).to.eql(1);

        //3. Handle messages
        subscriber.on("smessage", (channel, message) => {
          console.log(`Received message from ${channel}: ${message}`);
          expect(channel).to.eql(c);
          expect(message).to.eql("This is a test message");
          total_num_messages++;
        });
      }
      expect(total_num_messages).to.eql(channels.length);
    });
  });
});
