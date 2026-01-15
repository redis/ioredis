import MockServer, { getConnectionName } from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";
import Redis from "../../../lib/redis";
import { noop } from "../../../lib/utils";

describe("cluster:spub/ssub", function () {
  it("should receive messages", (done) => {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "slots") {
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
    const clusterOptions = { shardedSubscribers: true };
    const ssub = new Cluster(startupNodes, clusterOptions);

    ssub.ssubscribe("test cluster", function () {
      const clientSocket = node2.findClientByName(
        "ioredis-cluster(ssubscriber)"
      );
      node2.write(clientSocket, ["smessage", "test shard channel", "hi"]);
    });
    ssub.on("smessage", function (channel, message) {
      expect(channel).to.eql("test shard channel");
      expect(message).to.eql("hi");
      ssub.disconnect();
      done();
    });
  });

  it("should works when sending regular commands", function (done) {
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const ssub: any = new Cluster([{ port: "30001" }]);

    ssub.ssubscribe("test cluster", function () {
      ssub.set("foo", "bar").then((res) => {
        expect(res).to.eql("OK");
        ssub.disconnect();
        done();
      });
    });
  });

  it("supports password", function (done) {
    const handler = function (argv, c) {
      if (argv[0] === "auth") {
        c.password = argv[1];
        return;
      }
      if (argv[0] === "ssubscribe") {
        expect(c.password).to.eql("abc");
        expect(getConnectionName(c)).to.eql("ioredis-cluster(subscriber)");
      }
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    new MockServer(30001, handler);

    const ssub: any = new Cluster([{ port: "30001", password: "abc" }]);

    ssub.ssubscribe("test cluster", function () {
      ssub.disconnect();
      done();
    });
  });

  // This test covers the error handler used only for sharded-subscriber-triggered
  // slots cache refreshes. Normal (non-subscriber) connections are created with
  // lazyConnect: true and can become zombied. For sharded subscribers, a
  // ClusterAllFailedError means we have lost all nodes from the subscriber
  // perspective and must tear down.
  it("should trigger reconnect when subscriber node goes down and refresh fails", (done) => {
    let clusterSlotsCallCount = 0;
    const handler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        clusterSlotsCallCount++;
        // First call: during connect() - must succeed to reach "ready" state
        // Second call: subscriber-triggered refresh after we kill the subscriber - fail to trigger reconnect
        if (clusterSlotsCallCount === 2) {
          return new Error("CLUSTERDOWN The cluster is down");
        }
        return [[0, 16383, ["127.0.0.1", 30001]]];
      }
    };
    const server = new MockServer(30001, handler);

    const ssub = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
      shardedSubscribers: true,
      slotsRefreshInterval: 0, // Disable periodic refresh - test subscriber-triggered path only
    });

    ssub.once("ready", () => {
      // Close ONLY the subscriber connections, not the main connection.
      // The main connection stays open ("zombied") so that the reconnect is
      // driven solely by the sharded-subscriber error path, not by pool drain.
      server
        .getAllClients()
        .filter((client) => getConnectionName(client)?.includes("ssub"))
        .forEach((client) => client.destroy());
    });

    // After the subscriber-triggered slots refresh fails, we expect the
    // Cluster instance to transition into the reconnecting state.
    ssub.on("reconnecting", () => {
      ssub.disconnect();
      done();
    });
  });

  it("should re-subscribe after reconnection", function (done) {
    new MockServer(30001, function (argv) {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return [[0, 16383, ["127.0.0.1", 30001]]];
      } else if (argv[0] === "ssubscribe" || argv[0] === "psubscribe") {
        return [argv[0], argv[1]];
      }
    });
    const client: any = new Cluster([{ host: "127.0.0.1", port: "30001" }]);

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
