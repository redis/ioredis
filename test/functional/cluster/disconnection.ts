import * as sinon from "sinon";
import { expect, use } from "chai";
import { Cluster } from "../../../lib";
import MockServer from "../../helpers/mock_server";

use(require("chai-as-promised"));

describe("disconnection", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("should clear all timers on disconnect", (done) => {
    const server = new MockServer(30000);

    const setIntervalCalls = sinon.spy(global, "setInterval");
    const clearIntervalCalls = sinon.spy(global, "clearInterval");

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30000" }]);
    cluster.on("connect", () => {
      cluster.disconnect();
    });

    cluster.on("end", () => {
      setTimeout(() => {
        // wait for disconnect with refresher.
        expect(setIntervalCalls.callCount).to.equal(
          clearIntervalCalls.callCount
        );
        server.disconnect();
        done();
      }, 500);
    });
  });

  it("should clear all timers on server exits", (done) => {
    const server = new MockServer(30000);

    const setIntervalCalls = sinon.spy(global, "setInterval");
    const clearIntervalCalls = sinon.spy(global, "clearInterval");

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30000" }], {
      clusterRetryStrategy: null,
    });
    cluster.on("end", () => {
      expect(setIntervalCalls.callCount).to.equal(clearIntervalCalls.callCount);
      done();
    });

    server.disconnect();
  });

  it("should stay ended when the nodes end after disconnect", async () => {
    const slotTable = [
      [0, 8000, ["127.0.0.1", 30001]],
      [8001, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, () => {}, slotTable);
    new MockServer(30002, () => {}, slotTable);

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    await new Promise((resolve) => cluster.once("ready", resolve));
    const nodesEnded = cluster
      .nodes()
      .map((node) => new Promise((resolve) => node.once("end", resolve)));

    cluster.disconnect();
    await Promise.all(nodesEnded);
    await new Promise((resolve) => setImmediate(resolve));

    expect(cluster.status).to.equal("end");
    await expect(cluster.get("foo")).to.be.rejectedWith(
      "Connection is closed."
    );
  });

  const singleNodeSlots = [[0, 16383, ["127.0.0.1", 30000]]];
  const trackStatusEvents = (cluster: Cluster) => {
    const events: string[] = [];
    for (const event of ["disconnecting", "close", "end"]) {
      cluster.on(event, () => events.push(event));
    }
    return events;
  };

  for (const method of ["disconnect", "quit"] as const) {
    it(`should end when ${method}() is called while reconnecting`, async () => {
      const server = new MockServer(30000, () => {}, singleNodeSlots);
      const cluster = new Cluster([{ host: "127.0.0.1", port: "30000" }], {
        clusterRetryStrategy: () => 1000,
      });
      await new Promise((resolve) => cluster.once("ready", resolve));

      server.disconnect();
      await new Promise((resolve) => cluster.once("reconnecting", resolve));
      const events = trackStatusEvents(cluster);
      await cluster[method]();
      await new Promise((resolve) => setImmediate(resolve));

      expect(events).to.eql(["disconnecting", "close", "end"]);
      expect(cluster.status).to.equal("end");
      await expect(cluster.get("foo")).to.be.rejectedWith(
        "Connection is closed."
      );
    });

    it(`should stay ended when ${method}() is called after end`, async () => {
      new MockServer(30000, () => {}, singleNodeSlots);
      const cluster = new Cluster([{ host: "127.0.0.1", port: "30000" }]);
      await new Promise((resolve) => cluster.once("ready", resolve));
      cluster.disconnect();
      await new Promise((resolve) => cluster.once("end", resolve));
      const events = trackStatusEvents(cluster);

      await cluster[method]();
      await new Promise((resolve) => setImmediate(resolve));

      expect(events).to.eql([]);
      expect(cluster.status).to.equal("end");
      await expect(cluster.get("foo")).to.be.rejectedWith(
        "Connection is closed."
      );
    });
  }

  it("should reconnect once when disconnect(true) is called while reconnecting", async () => {
    const server = new MockServer(30000, () => {}, singleNodeSlots);
    const clusterRetryStrategy = sinon.spy(() => 100);
    const cluster = new Cluster([{ host: "127.0.0.1", port: "30000" }], {
      clusterRetryStrategy,
    });
    await new Promise((resolve) => cluster.once("ready", resolve));

    const reconnecting = new Promise((resolve) =>
      cluster.once("reconnecting", resolve)
    );
    await server.disconnectPromise();
    await reconnecting;
    new MockServer(30000, () => {}, singleNodeSlots);
    cluster.disconnect(true);
    await new Promise((resolve) => cluster.once("ready", resolve));

    expect(clusterRetryStrategy.callCount).to.equal(1);
    cluster.disconnect();
  });
});
