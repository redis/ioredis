import { expect } from "chai";
import { Socket } from "net";
import MockServer, {
  pubSubReply,
  rawPubSubReply,
} from "../helpers/mock_server";
import Redis from "../../lib/Redis";

// Redis counts shard channels separately from channels and patterns, so the
// count carried by an (S)UNSUBSCRIBE reply only describes channels of the same
// kind. Dropping the subscriber state on that count alone loses subscriptions
// of the other kinds that are still active on the connection.
const PROTOCOLS = [3, 2] as const;

// `Redis#mode` only reports the subscriber state under RESP2. With RESP3 push
// messages share the connection, so it reads `"normal"` even while subscribed
// and asserting on it would pass whether or not the subscription state was
// cleaned up. `condition.subscriber` is the check that discriminates on both.
function expectSubscriptionStateCleared(
  redis: Redis,
  protocol: typeof PROTOCOLS[number]
) {
  expect(redis.condition.subscriber).to.equal(false);
  if (protocol === 2) {
    expect(redis.mode).to.equal("normal");
  }
}

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

    it("clears the subscription state once every kind is unsubscribed", async () => {
      redis = new Redis({ port, protocol });
      await redis.subscribe("regular");
      await redis.ssubscribe("shard");
      await redis.unsubscribe("regular");
      await redis.sunsubscribe("shard");

      expectSubscriptionStateCleared(redis, protocol);
    });

    // `""` is a legal channel name, and the reply naming it must still be
    // removed from the subscription set — a truthiness check on the channel
    // skips the removal and leaves the connection stuck in subscriber mode.
    it("clears the subscription state after unsubscribing an empty channel name", async () => {
      redis = new Redis({ port, protocol });
      await redis.subscribe("");
      await redis.unsubscribe("");

      expectSubscriptionStateCleared(redis, protocol);
    });

    it("clears the subscription state after sunsubscribing an empty shard channel name", async () => {
      redis = new Redis({ port, protocol });
      await redis.ssubscribe("");
      await redis.sunsubscribe("");

      expectSubscriptionStateCleared(redis, protocol);
    });

    // Channel names are chosen by the application, so they can collide with
    // the names inherited from `Object.prototype`. `__proto__` in particular
    // is never stored as an own key on a plain object, so the subscription
    // set would report itself empty while the channel is still subscribed.
    it("keeps a channel named __proto__ subscribed after sunsubscribe", async () => {
      redis = new Redis({ port, protocol });
      await redis.subscribe("__proto__");
      await redis.ssubscribe("shard");
      await redis.sunsubscribe("shard");

      const { subscriber } = redis.condition;
      expect(subscriber).to.not.equal(false);
      expect((subscriber as any).channels("subscribe")).to.eql(["__proto__"]);
      expect((subscriber as any).channels("ssubscribe")).to.eql([]);
    });

    it("delivers messages on a channel named __proto__ after sunsubscribe", (done) => {
      redis = new Redis({ port, protocol });
      redis.on("message", (channel, message) => {
        expect(channel).to.eql("__proto__");
        expect(message).to.eql("hi");
        done();
      });
      (async () => {
        await redis.subscribe("__proto__");
        await redis.ssubscribe("shard");
        await redis.sunsubscribe("shard");
        server.broadcast(pubSubReply(protocol, "message", "__proto__", "hi"));
      })();
    });

    // The removal has to reach the stored key as well: the channel is tracked
    // while subscribed, and unsubscribing it empties the set and leaves the
    // connection out of subscriber mode.
    it("tracks and then clears a subscription to __proto__", async () => {
      redis = new Redis({ port, protocol });
      await redis.subscribe("__proto__");
      expect((redis.condition.subscriber as any).channels("subscribe")).to.eql([
        "__proto__",
      ]);

      await redis.unsubscribe("__proto__");
      expectSubscriptionStateCleared(redis, protocol);
    });

    // Channel names are binary safe, but the subscription set keys them by
    // their utf8 rendering, so two distinct names can collapse onto one key:
    // `<80>` and `<81>` are both invalid utf8 and both render as U+FFFD.
    // Unsubscribing one empties the set while the server still reports the
    // other as subscribed, so the set alone cannot decide this transition --
    // the count in the reply is what says a same-kind subscription remains.
    describe("with binary channel names that share a utf8 rendering", () => {
      const first = Buffer.from([0x80]);
      const second = Buffer.from([0x81]);

      // Replies naming these channels have to keep the raw bytes, which the
      // mock server's string-based writer cannot do, so they are written to
      // the socket directly and the automatic reply is suppressed.
      function replyWithBytes(
        socket: Socket,
        type: string,
        channel: Buffer,
        count: number
      ) {
        socket.write(rawPubSubReply(protocol, type, channel, count));
      }

      // Both SUBSCRIBEs are acknowledged with the channel the client asked
      // for; the server counts them separately, so the second reports 2.
      // UNSUBSCRIBE of the first then reports 1 remaining.
      function serveBinaryChannels(server: MockServer) {
        let subscribed = 0;
        server.handler = (argv, socket, flags) => {
          const name = String(argv[0]).toLowerCase();
          if (name === "info") {
            return "# Server\r\nredis_version:7.0.0\r\n";
          }
          if (name === "subscribe") {
            subscribed += 1;
            flags.hang = true;
            replyWithBytes(
              socket,
              "subscribe",
              subscribed === 1 ? first : second,
              subscribed
            );
            return undefined;
          }
          if (name === "unsubscribe") {
            subscribed -= 1;
            flags.hang = true;
            replyWithBytes(socket, "unsubscribe", first, subscribed);
            return undefined;
          }
          return "OK";
        };
      }

      it("keeps subscriber mode while the other one is still subscribed", async () => {
        serveBinaryChannels(server);
        redis = new Redis({ port, protocol });
        await redis.subscribe(first);
        await redis.subscribe(second);
        await redis.unsubscribe(first);

        expect(redis.condition.subscriber).to.not.equal(false);
        if (protocol === 2) {
          expect(redis.mode).to.equal("subscriber");
        }
      });

      it("still delivers messages on the one that is still subscribed", (done) => {
        serveBinaryChannels(server);
        redis = new Redis({ port, protocol });
        redis.on("messageBuffer", (channel, message) => {
          expect(channel).to.eql(second);
          expect(message.toString()).to.equal("hi");
          done();
        });
        (async () => {
          await redis.subscribe(first);
          await redis.subscribe(second);
          await redis.unsubscribe(first);
          server
            .getAllClients()[0]
            .write(rawPubSubReply(protocol, "message", second, "hi"));
        })();
      });
    });
  });
});
