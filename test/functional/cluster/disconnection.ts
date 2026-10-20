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
});
