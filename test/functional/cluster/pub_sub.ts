import MockServer, {
  getConnectionName,
  pubSubReply,
} from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";
import Redis from "../../../lib/Redis";
import { noop } from "../../../lib/utils";

describe("cluster:pub/sub", function () {
  ([2, 3] as const).forEach((protocol) => {
    it(`should receive messages - RESP ${protocol}`, (done) => {
      const handler = function (argv) {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [
            [0, 1, ["127.0.0.1", 30001]],
            [2, 16383, ["127.0.0.1", 30002]],
          ];
        }
        if (argv[0] === "subscribe") {
          return pubSubReply(protocol, "subscribe", argv[1]);
        }
      };
      const node1 = new MockServer(30001, handler);
      new MockServer(30002, handler);

      const options = [{ host: "127.0.0.1", port: "30001" }];
      const sub = new Cluster(options, { redisOptions: { protocol } });

      sub.subscribe("test cluster", function () {
        const clientSocket = node1.findClientByName(
          "ioredis-cluster(subscriber)"
        );
        node1.write(
          clientSocket,
          pubSubReply(protocol, "message", "test channel", "hi")
        );
      });
      sub.on("message", function (channel, message) {
        expect(channel).to.eql("test channel");
        expect(message).to.eql("hi");
        sub.disconnect();
        done();
      });
    });
  });

  ([2, 3] as const).forEach((protocol) => {
    it(`should works when sending regular commands - RESP ${protocol}`, (done) => {
      const handler = function (argv) {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [[0, 16383, ["127.0.0.1", 30001]]];
        }
        if (argv[0] === "subscribe") {
          return pubSubReply(protocol, "subscribe", argv[1]);
        }
      };
      new MockServer(30001, handler);

      const sub = new Cluster([{ port: "30001" }], {
        redisOptions: { protocol },
      });

      sub.subscribe("test cluster", function () {
        sub.set("foo", "bar").then((res) => {
          expect(res).to.eql("OK");
          sub.disconnect();
          done();
        });
      });
    });
  });

  ([2, 3] as const).forEach((protocol) => {
    it(`supports password - RESP ${protocol}`, (done) => {
      const handler = function (argv, c) {
        if (argv[0] === "auth") {
          c.password = argv[1];
          return;
        }
        if (argv[0] === "hello") {
          c.password = argv[4];
          return;
        }
        if (argv[0] === "subscribe") {
          expect(c.password).to.eql("abc");
          expect(getConnectionName(c)).to.eql("ioredis-cluster(subscriber)");
          return pubSubReply(protocol, "subscribe", argv[1]);
        }
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [[0, 16383, ["127.0.0.1", 30001]]];
        }
      };
      new MockServer(30001, handler);

      const sub = new Cluster([{ port: "30001", password: "abc" }], {
        redisOptions: { protocol },
      });

      sub.subscribe("test cluster", function () {
        sub.disconnect();
        done();
      });
    });
  });

  ([2, 3] as const).forEach((protocol) => {
    it(`should re-subscribe after reconnection - RESP ${protocol}`, (done) => {
      new MockServer(30001, function (argv) {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [[0, 16383, ["127.0.0.1", 30001]]];
        } else if (argv[0] === "subscribe" || argv[0] === "psubscribe") {
          return pubSubReply(protocol, argv[0], argv[1]);
        }
      });
      const client = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        redisOptions: { protocol },
      });

      client.subscribe("test cluster", function () {
        const stub = sinon
          .stub(Redis.prototype, "subscribe")
          .callsFake((channels) => {
            expect(channels).to.eql(["test cluster"]);
            stub.restore();
            client.disconnect();
            done();
            return Redis.prototype.subscribe.apply(this, arguments);
          });
        client.once("end", function () {
          client.connect().catch(noop);
        });
        client.disconnect();
      });
    });
  });

  ([2, 3] as const).forEach((protocol) => {
    it(`should re-psubscribe after reconnection - RESP ${protocol}`, (done) => {
      new MockServer(30001, function (argv) {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [[0, 16383, ["127.0.0.1", 30001]]];
        } else if (argv[0] === "subscribe" || argv[0] === "psubscribe") {
          return pubSubReply(protocol, argv[0], argv[1]);
        }
      });
      const client = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        redisOptions: { protocol },
      });

      client.psubscribe("test?", function () {
        const stub = sinon
          .stub(Redis.prototype, "psubscribe")
          .callsFake((channels) => {
            expect(channels).to.eql(["test?"]);
            stub.restore();
            client.disconnect();
            done();
            return Redis.prototype.psubscribe.apply(this, arguments);
          });
        client.once("end", function () {
          client.connect().catch(noop);
        });
        client.disconnect();
      });
    });
  });
});
