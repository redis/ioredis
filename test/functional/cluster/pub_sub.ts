import MockServer, { getConnectionName } from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";
import Redis from "../../../lib/redis";

describe("cluster:pub/sub", function() {
  it("should receive messages", function(done) {
    var handler = function(argv) {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return [
          [0, 1, ["127.0.0.1", 30001]],
          [2, 16383, ["127.0.0.1", 30002]]
        ];
      }
    };
    var node1 = new MockServer(30001, handler);
    new MockServer(30002, handler);

    var options = [{ host: "127.0.0.1", port: "30001" }];
    var sub = new Cluster(options);

    sub.subscribe("test cluster", function() {
      node1.write(node1.findClientByName("ioredisClusterSubscriber"), [
        "message",
        "test channel",
        "hi"
      ]);
    });
    sub.on("message", function(channel, message) {
      expect(channel).to.eql("test channel");
      expect(message).to.eql("hi");
      sub.disconnect();
      done();
    });
  });

  it("should works when sending regular commands", function(done) {
    var handler = function(argv) {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    var sub = new Cluster([{ port: "30001" }]);

    sub.subscribe("test cluster", function() {
      sub.set("foo", "bar").then(res => {
        expect(res).to.eql("OK");
        done();
      });
    });
  });

  it("supports password", function(done) {
    const handler = function(argv, c) {
      if (argv[0] === "auth") {
        c.password = argv[1];
        return;
      }
      if (argv[0] === "subscribe") {
        expect(c.password).to.eql("abc");
        expect(getConnectionName(c)).to.eql("ioredisClusterSubscriber");
      }
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    var sub = new Cluster([{ port: "30001", password: "abc" }]);

    sub.subscribe("test cluster", function() {
      done();
    });
  });

  it("should re-subscribe after reconnection", function(done) {
    new MockServer(30001, function(argv) {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      } else if (argv[0] === "subscribe" || argv[0] === "psubscribe") {
        return [argv[0], argv[1]];
      }
    });
    var client = new Cluster([{ host: "127.0.0.1", port: "30001" }]);

    client.subscribe("test cluster", function() {
      const stub = sinon
        .stub(Redis.prototype, "subscribe")
        .callsFake(channels => {
          expect(channels).to.eql(["test cluster"]);
          stub.restore();
          client.disconnect();
          done();
          return Redis.prototype.subscribe.apply(this, arguments);
        });
      client.once("end", function() {
        client.connect();
      });
      client.disconnect();
    });
  });

  it("should re-psubscribe after reconnection", function(done) {
    new MockServer(30001, function(argv) {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      } else if (argv[0] === "subscribe" || argv[0] === "psubscribe") {
        return [argv[0], argv[1]];
      }
    });
    var client = new Cluster([{ host: "127.0.0.1", port: "30001" }]);

    client.psubscribe("test?", function() {
      const stub = sinon
        .stub(Redis.prototype, "psubscribe")
        .callsFake(channels => {
          expect(channels).to.eql(["test?"]);
          stub.restore();
          client.disconnect();
          done();
          return Redis.prototype.psubscribe.apply(this, arguments);
        });
      client.once("end", function() {
        client.connect();
      });
      client.disconnect();
    });
  });
});
