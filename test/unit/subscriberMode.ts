import { expect } from "chai";
import MockServer, { pubSubReply } from "../helpers/mock_server";
import Redis from "../../lib/Redis";
import SubscriptionSet from "../../lib/SubscriptionSet";

// Redis counts regular channels and patterns together and shard channels
// separately, so the count carried by an unsubscribe reply describes only its
// own group. Dropping the subscriber state on that count alone loses
// subscriptions of the other group that are still active on the connection.
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
        // Each group reports its own remaining count.
        if (name === "subscribe" || name === "ssubscribe") {
          return pubSubReply(protocol, name, argv[1], 1);
        }
        if (name === "unsubscribe" || name === "sunsubscribe") {
          return pubSubReply(protocol, name, argv[1], 0);
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

    it("clears the subscription state once every kind is unsubscribed", async () => {
      redis = new Redis({ port, protocol });
      await redis.subscribe("regular");
      await redis.ssubscribe("shard");
      await redis.unsubscribe("regular");
      await redis.sunsubscribe("shard");

      expect(redis.condition.subscriber).to.equal(false);
      // `Redis#mode` reports the subscriber state under RESP2 only.
      if (protocol === 2) {
        expect(redis.mode).to.equal("normal");
      }
    });
  });
});

describe("SubscriptionSet", () => {
  // `__proto__` is never stored as an own key on a plain object.
  it("tracks a channel named __proto__", () => {
    const set = new SubscriptionSet();
    set.add("subscribe", "__proto__");
    expect(set.isEmpty()).to.equal(false);
  });

  // `<80>` and `<81>` are both invalid utf8 and render as the same string.
  it("keeps binary channel names that share a utf8 rendering apart", () => {
    const set = new SubscriptionSet();
    set.add("subscribe", Buffer.from([0x80]));
    set.add("subscribe", Buffer.from([0x81]));
    set.del("unsubscribe", Buffer.from([0x80]));
    expect(set.isEmpty()).to.equal(false);
  });
});
