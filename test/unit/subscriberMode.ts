import { expect } from "chai";
import MockServer, { pubSubReply } from "../helpers/mock_server";
import Redis from "../../lib/Redis";

// Redis counts shard channels separately from channels and patterns, so the
// count carried by an (S)UNSUBSCRIBE reply only describes channels of the same
// kind. Dropping the subscriber state on that count alone loses subscriptions
// of the other kinds that are still active on the connection.
const PROTOCOLS = [3, 2] as const;

PROTOCOLS.forEach((protocol, index) => {
  describe(`subscriber mode across channel kinds (RESP${protocol})`, () => {
    const port = 17940 + index;
    let server: MockServer;
    let redis: Redis;

    beforeEach(() => {
      server = new MockServer(port, (argv) => {
        const name = String(argv[0]).toLowerCase();
        if (name === "info") {
          return "# Server\r\nredis_version:7.0.0\r\n";
        }
        // Each kind reports the remaining count for that kind only.
        if (name === "subscribe" || name === "ssubscribe") {
          return pubSubReply(protocol, name, argv[1], 1);
        }
        if (name === "sunsubscribe") {
          return pubSubReply(protocol, "sunsubscribe", argv[1], 0);
        }
        if (name === "unsubscribe") {
          return pubSubReply(protocol, "unsubscribe", argv[1], 0);
        }
        return "OK";
      });
    });

    afterEach(() => {
      if (redis && redis.status !== "end") {
        redis.disconnect();
      }
      server.disconnect();
    });

    it("keeps the regular subscription after sunsubscribe", async () => {
      redis = new Redis({ port, protocol });
      await redis.subscribe("regular");
      await redis.ssubscribe("shard");
      await redis.sunsubscribe("shard");

      const { subscriber } = redis.condition;
      expect(subscriber).to.not.equal(false);
      expect((subscriber as any).channels("subscribe")).to.eql(["regular"]);
      expect((subscriber as any).channels("ssubscribe")).to.eql([]);
    });

    it("delivers messages on a channel still subscribed after sunsubscribe", (done) => {
      redis = new Redis({ port, protocol });
      redis.on("message", (channel, message) => {
        expect(channel).to.eql("regular");
        expect(message).to.eql("hi");
        done();
      });
      (async () => {
        await redis.subscribe("regular");
        await redis.ssubscribe("shard");
        await redis.sunsubscribe("shard");
        server.broadcast(pubSubReply(protocol, "message", "regular", "hi"));
      })();
    });

    it("keeps the shard subscription after unsubscribe", async () => {
      redis = new Redis({ port, protocol });
      await redis.ssubscribe("shard");
      await redis.subscribe("regular");
      await redis.unsubscribe("regular");

      const { subscriber } = redis.condition;
      expect(subscriber).to.not.equal(false);
      expect((subscriber as any).channels("ssubscribe")).to.eql(["shard"]);
      expect((subscriber as any).channels("subscribe")).to.eql([]);
    });

    it("leaves subscriber mode once every kind is unsubscribed", async () => {
      redis = new Redis({ port, protocol });
      await redis.subscribe("regular");
      await redis.ssubscribe("shard");
      await redis.unsubscribe("regular");
      await redis.sunsubscribe("shard");

      expect(redis.condition.subscriber).to.equal(false);
      expect(redis.mode).to.equal("normal");
    });
  });
});
