import Redis from "../../lib/Redis";
import * as sinon from "sinon";
import { expect } from "chai";
import MockServer from "../helpers/mock_server";

describe("disconnection", function () {
  afterEach(() => {
    sinon.restore();
  });

  it("should clear all timers on disconnect", function (done) {
    const server = new MockServer(30000);

    const setIntervalCalls = sinon.spy(global, "setInterval");
    const clearIntervalCalls = sinon.spy(global, "clearInterval");

    const redis = new Redis({});
    redis.on("connect", function () {
      redis.disconnect();
    });

    redis.on("end", function () {
      expect(setIntervalCalls.callCount).to.equal(clearIntervalCalls.callCount);
      server.disconnect();
      done();
    });
  });

  it("should clear all timers on server exits", function (done) {
    const server = new MockServer(30000);

    const setIntervalCalls = sinon.spy(global, "setInterval");
    const clearIntervalCalls = sinon.spy(global, "clearInterval");

    const redis = new Redis({
      port: 30000,
      retryStrategy: null,
    });
    redis.on("end", function () {
      expect(setIntervalCalls.callCount).to.equal(clearIntervalCalls.callCount);
      done();
    });

    server.disconnect();
  });
});
