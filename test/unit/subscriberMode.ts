import { expect } from "chai";
import MockServer, {
  pubSubReply,
  rawPubSubReply,
} from "../helpers/mock_server";
import Redis from "../../lib/Redis";

// Redis counts regular channels and patterns together and shard channels
// separately, so the count carried by an unsubscribe reply describes only its
// own group. Dropping the subscriber state on that count alone loses
// subscriptions of the other group that are still active on the connection.
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
        // Each group reports its own remaining count.
        if (
          name === "subscribe" ||
          name === "ssubscribe" ||
          name === "psubscribe"
        ) {
          return pubSubReply(protocol, name, argv[1], 1);
        }
        if (
          name === "sunsubscribe" ||
          name === "unsubscribe" ||
          name === "punsubscribe"
        ) {
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
      })().catch(done);
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

    it("keeps the pattern subscription after sunsubscribe", async () => {
      redis = new Redis({ port, protocol });
      await redis.psubscribe("reg*");
      await redis.ssubscribe("shard");
      await redis.sunsubscribe("shard");

      const { subscriber } = redis.condition;
      expect(subscriber).to.not.equal(false);
      expect((subscriber as any).channels("psubscribe")).to.eql(["reg*"]);
    });

    it("keeps the shard subscription after punsubscribe", async () => {
      redis = new Redis({ port, protocol });
      await redis.ssubscribe("shard");
      await redis.psubscribe("reg*");
      await redis.punsubscribe("reg*");

      const { subscriber } = redis.condition;
      expect(subscriber).to.not.equal(false);
      expect((subscriber as any).channels("ssubscribe")).to.eql(["shard"]);
    });

    // Regular channels and patterns share one count: unsubscribing the
    // channel reports the pattern as remaining, and only the pattern's own
    // acknowledgement brings that count to zero.
    it("leaves subscriber mode only when the shared channel and pattern count reaches zero", async () => {
      let shared = 0;
      server.handler = (argv) => {
        const name = String(argv[0]).toLowerCase();
        if (name === "info") {
          return "# Server\r\nredis_version:7.0.0\r\n";
        }
        if (name === "subscribe" || name === "psubscribe") {
          shared += 1;
          return pubSubReply(protocol, name, argv[1], shared);
        }
        if (name === "unsubscribe" || name === "punsubscribe") {
          shared -= 1;
          return pubSubReply(protocol, name, argv[1], shared);
        }
        return "OK";
      };
      redis = new Redis({ port, protocol });
      await redis.subscribe("regular");
      await redis.psubscribe("reg*");
      await redis.unsubscribe("regular");
      expect(redis.condition.subscriber).to.not.equal(false);

      await redis.punsubscribe("reg*");
      expectSubscriptionStateCleared(redis, protocol);
    });

    // The set can be empty while the server still counts a subscription this
    // connection never tracked: the count alone keeps subscriber mode.
    it("stays in subscriber mode on a positive count with an empty set", async () => {
      server.handler = (argv) => {
        const name = String(argv[0]).toLowerCase();
        if (name === "info") {
          return "# Server\r\nredis_version:7.0.0\r\n";
        }
        if (name === "subscribe") {
          return pubSubReply(protocol, name, argv[1], 2);
        }
        if (name === "unsubscribe") {
          return pubSubReply(protocol, name, argv[1], 1);
        }
        return "OK";
      };
      redis = new Redis({ port, protocol });
      await redis.subscribe("regular");
      await redis.unsubscribe("regular");

      expect((redis.condition.subscriber as any).isEmpty()).to.equal(true);
      expect(redis.condition.subscriber).to.not.equal(false);
    });

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
      })().catch(done);
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

    // A server or proxy that answers SUBSCRIBE with a plain `+OK` instead of
    // the usual three-element acknowledgement leaves `reply[1]` as one byte of
    // that string. The subscription set runs inside the decoder's reply
    // dispatch, so it must not throw on it; it records the byte's decimal
    // rendering and the command settles.
    it("tracks a subscribe acknowledgement that is not an array", async () => {
      server.handler = (argv) => {
        const name = String(argv[0]).toLowerCase();
        if (name === "info") {
          return "# Server\r\nredis_version:7.0.0\r\n";
        }
        return "OK";
      };
      redis = new Redis({ port, protocol });
      await redis.subscribe("regular");

      const { subscriber } = redis.condition;
      expect(subscriber).to.not.equal(false);
      // `"OK"[1]` decodes to the byte 0x4b.
      expect((subscriber as any).channels("subscribe")).to.eql(["75"]);
    });

    // Channel names are binary safe, so the subscription set has to key them
    // by their bytes: `<80>` and `<81>` are both invalid utf8 and both render
    // as U+FFFD, so keying by that rendering collapses the two onto one entry
    // and unsubscribing either one drops both from the set.
    describe("with binary channel names that share a utf8 rendering", () => {
      const first = Buffer.from([0x80]);
      const second = Buffer.from([0x81]);

      // Replies naming these channels have to keep the raw bytes, which the
      // mock server's string-based writer cannot do, so the handler writes
      // them to the socket itself and hangs the automatic reply. Both
      // SUBSCRIBEs are acknowledged with the channel the client asked for;
      // the server counts them separately, so the second reports 2.
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
            socket.write(
              rawPubSubReply(
                protocol,
                "subscribe",
                subscribed === 1 ? first : second,
                subscribed
              )
            );
            return undefined;
          }
          if (name === "unsubscribe") {
            subscribed -= 1;
            flags.hang = true;
            socket.write(
              rawPubSubReply(protocol, "unsubscribe", first, subscribed)
            );
            return undefined;
          }
          // Shard channels are counted separately by the server, so the shard
          // acknowledgements carry their own count and say nothing about the
          // regular channels that are still subscribed.
          if (name === "ssubscribe") {
            return pubSubReply(protocol, "ssubscribe", argv[1], 1);
          }
          if (name === "sunsubscribe") {
            return pubSubReply(protocol, "sunsubscribe", argv[1], 0);
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

      // The count in an acknowledgement only describes its own kind, so a
      // shard count of 0 says nothing about the two regular channels. If the
      // set has collapsed them onto one key it already reads empty by then,
      // and the connection leaves subscriber mode with a channel still live.
      it("keeps subscriber mode when a shard count of 0 arrives later", async () => {
        serveBinaryChannels(server);
        redis = new Redis({ port, protocol });
        await redis.subscribe(first);
        await redis.subscribe(second);
        await redis.unsubscribe(first);
        await redis.ssubscribe("shard");
        await redis.sunsubscribe("shard");

        expect(redis.condition.subscriber).to.not.equal(false);
        if (protocol === 2) {
          expect(redis.mode).to.equal("subscriber");
        }
      });

      it("still delivers messages after a later shard count of 0", (done) => {
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
          await redis.ssubscribe("shard");
          await redis.sunsubscribe("shard");
          server
            .getAllClients()[0]
            .write(rawPubSubReply(protocol, "message", second, "hi"));
        })().catch(done);
      });

      it("tracks both names as separate channels", async () => {
        serveBinaryChannels(server);
        redis = new Redis({ port, protocol });
        await redis.subscribe(first);
        await redis.subscribe(second);

        const { subscriber } = redis.condition;
        expect((subscriber as any).channels("subscribe")).to.have.lengthOf(2);
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
        })().catch(done);
      });
    });
  });
});
