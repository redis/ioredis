import * as sinon from "sinon";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import MockServer from "../../helpers/mock_server";

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
});
