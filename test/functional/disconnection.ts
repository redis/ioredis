import Redis from "../../lib/Redis";
import * as sinon from "sinon";
import { expect, use } from "chai";
import MockServer from "../helpers/mock_server";

use(require("chai-as-promised"));

describe("disconnection", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("should clear all timers on disconnect", (done) => {
    const server = new MockServer(30000);

    const setIntervalCalls = sinon.spy(global, "setInterval");
    const clearIntervalCalls = sinon.spy(global, "clearInterval");

    const redis = new Redis({});
    redis.on("connect", () => {
      redis.disconnect();
    });

    redis.on("end", () => {
      expect(setIntervalCalls.callCount).to.equal(clearIntervalCalls.callCount);
      server.disconnect();
      done();
    });
  });

  ["disconnect", "quit"].forEach((method) => {
    it(`should end when ${method}() is called while reconnecting`, async () => {
      const server = new MockServer(30001);
      const redis = new Redis({ port: 30001, retryStrategy: () => 1000 });
      await new Promise((resolve) => redis.once("ready", resolve));

      server.disconnect();
      await new Promise((resolve) => redis.once("reconnecting", resolve));
      await redis[method]();
      await new Promise((resolve) => setImmediate(resolve));

      expect(redis.status).to.equal("end");
      await expect(redis.get("foo")).to.be.rejectedWith(
        "Connection is closed."
      );
    });
  });

  it("should clear all timers on server exits", (done) => {
    const server = new MockServer(30000);

    const setIntervalCalls = sinon.spy(global, "setInterval");
    const clearIntervalCalls = sinon.spy(global, "clearInterval");

    const redis = new Redis({
      port: 30000,
      retryStrategy: null,
    });
    redis.on("end", () => {
      expect(setIntervalCalls.callCount).to.equal(clearIntervalCalls.callCount);
      done();
    });

    server.disconnect();
  });
});
