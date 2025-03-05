import MockServer, { getConnectionName } from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";
import Redis from "../../../lib/Redis";
import { noop } from "../../../lib/utils";

describe("cluster:spub/ssub", function () {
  it("should receive messages", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 1, ["127.0.0.1", 30001]],
          [2, 16383, ["127.0.0.1", 30002]],
        ];
      }
    };
    new MockServer(30001, handler);
    //Node 2 is responsible for the vast majority of slots
    const node2 = new MockServer(30002, handler);
    const startupNodes = [{ host: "127.0.0.1", port: 30001 }];
    const clusterOptions = {shardedSubscribers: true};
    const ssub = new Cluster(startupNodes, clusterOptions);

    ssub.ssubscribe("test cluster", function () {
      const clientSocket = node2.findClientByName("ioredis-cluster(ssubscriber)");
      node2.write(clientSocket, [
        "smessage",
        "test shard channel",
        "hi",
      ]);
    });
    ssub.on("smessage", function (channel, message) {
      expect(channel).to.eql("test shard channel");
      expect(message).to.eql("hi");
      ssub.disconnect();
      done();
    });
  });

  it("should works when sending regular commands", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const ssub = new Cluster([{ port: "30001" }], {shardedSubscribers: true});

    ssub.ssubscribe("test cluster", function () {
      ssub.set("foo", "bar").then((res) => {
        expect(res).to.eql("OK");
        ssub.disconnect();
        done();
      });
    });
  });

  it("supports password", (done) => {
    const handler = function (argv, c) {
      if (argv[0] === "auth") {
        c.password = argv[1];
        return;
      }
      if (argv[0] === "ssubscribe") {
        expect(c.password).to.eql("abc");
        expect(getConnectionName(c)).to.eql("ioredis-cluster(ssubscriber)");
      }
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const ssub = new Redis.Cluster([{ port: 30001, password: "abc" }], {shardedSubscribers: true});

    ssub.ssubscribe("test cluster", function () {
      ssub.disconnect();
      done();
    });
  });

  it("should re-ssubscribe after reconnection", (done) => {
    new MockServer(30001, function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      } else if (argv[0] === "ssubscribe" || argv[0] === "psubscribe") {
        return [argv[0], argv[1]];
      }
    });
    const client = new Cluster([{ host: "127.0.0.1", port: 30001 }], {shardedSubscribers: true});
    client.ssubscribe("test cluster", function () {
      const stub = sinon
        .stub(Redis.prototype, "ssubscribe")
        .callsFake((channels) => {
          expect(channels).to.eql(["test cluster"]);
          stub.restore();
          client.disconnect();
          done();
          return Redis.prototype.ssubscribe.apply(this, arguments);
        });
      client.once("end", function () {
        client.connect().catch(noop);
      });
      client.disconnect();
    });
  });
});
