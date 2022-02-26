import Redis from "../../lib/Redis";
import { expect } from "chai";
import * as sinon from "sinon";
import { waitForMonitorReady } from "../helpers/util";

describe("monitor", function () {
  it("should receive commands", function (done) {
    const redis = new Redis();
    redis.on("ready", function () {
      redis.monitor(async (err, monitor) => {
        if (err) {
          done(err);
          return;
        }
        monitor.on("monitor", function (time, args) {
          expect(args[0]).to.eql("get");
          expect(args[1]).to.eql("foo");
          redis.disconnect();
          monitor.disconnect();
          done();
        });

        await waitForMonitorReady(monitor);
        redis.get("foo");
      });
    });
  });

  it("should reject processing commands", function (done) {
    const redis = new Redis();
    redis.monitor(async (err, monitor) => {
      await waitForMonitorReady(monitor);
      monitor.get("foo", function (err) {
        expect(err.message).to.match(/Connection is in monitoring mode/);
        redis.disconnect();
        monitor.disconnect();
        done();
      });
    });
  });

  it("should continue monitoring after reconnection", (done) => {
    const redis = new Redis();
    redis.monitor((err, monitor) => {
      if (err) {
        done(err);
        return;
      }
      monitor.on("monitor", (_time, args) => {
        if (args[0] === "set") {
          redis.disconnect();
          monitor.disconnect();
          done();
        }
      });
      monitor.disconnect(true);
      monitor.on("ready", async () => {
        await waitForMonitorReady(monitor);
        redis.set("foo", "bar");
      });
    });
  });

  it("should wait for the ready event before monitoring", function (done) {
    const redis = new Redis();
    redis.on("ready", function () {
      const readyCheck = sinon.spy(Redis.prototype, "_readyCheck");
      redis.monitor(function (err, monitor) {
        expect(readyCheck.callCount).to.eql(1);
        Redis.prototype._readyCheck.restore();
        redis.disconnect();
        monitor.disconnect();
        done();
      });
    });
  });
});
