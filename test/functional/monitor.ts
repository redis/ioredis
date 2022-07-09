import Redis from "../../lib/Redis";
import { expect, use } from "chai";
import * as sinon from "sinon";
import { getRedisVersion, waitForMonitorReady } from "../helpers/util";

use(require("chai-as-promised"));

describe("monitor", () => {
  it("should receive commands", (done) => {
    const redis = new Redis();
    redis.on("ready", () => {
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

  it("should reject processing commands", (done) => {
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

  it("should report being in 'monitor' mode", (done) => {
    const redis = new Redis();
    redis.monitor(async (err, monitor) => {
      await waitForMonitorReady(monitor);
      expect(redis.mode).to.equal("normal");
      expect(monitor.mode).to.equal("monitor");
      redis.disconnect();
      monitor.disconnect();
      done();
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

  it("should wait for the ready event before monitoring", (done) => {
    const redis = new Redis();
    redis.on("ready", () => {
      // @ts-expect-error
      const readyCheck = sinon.spy(Redis.prototype, "_readyCheck");
      redis.monitor((err, monitor) => {
        expect(readyCheck.callCount).to.eql(1);
        redis.disconnect();
        monitor.disconnect();
        done();
      });
    });
  });

  it("rejects when monitor is disabled", async () => {
    const redis = new Redis();
    const [major] = await getRedisVersion(redis);
    if (major < 6) {
      return;
    }

    await redis.acl("SETUSER", "nomonitor", "reset", "+info", ">123456", "on");

    await expect(
      new Redis({ username: "nomonitor", password: "123456" }).monitor()
    ).to.eventually.be.rejectedWith(/NOPERM/);
  });
});
