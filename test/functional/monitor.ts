import Redis from "../../lib/Redis";
import { expect, use } from "chai";
import * as sinon from "sinon";
import { waitForMonitorReady } from "../helpers/util";

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
          // Filter out handshake commands (client, info, select, auth, readonly)
          // and keep-alive commands (ping) - only process the actual 'get' command
          if (args[0] && args[0].toLowerCase() === "get") {
            expect(args[0]).to.match(/get/i);
            expect(args[1]).to.eql("foo");
            redis.disconnect();
            monitor.disconnect();
            done();
          }
        });

        await waitForMonitorReady();
        redis.get("foo");
      });
    });
  });

  it("should reject processing commands", (done) => {
    const redis = new Redis();
    redis.monitor(async (err, monitor) => {
      await waitForMonitorReady();
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
      await waitForMonitorReady();
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
        if (args[0] === "set" || args[0] === "SET") {
          redis.disconnect();
          monitor.disconnect();
          done();
        }
      });
      monitor.disconnect(true);
      monitor.on("ready", async () => {
        await waitForMonitorReady();
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
    await redis.acl("SETUSER", "nomonitor", "reset", "+info", ">123456", "on");

    await expect(
      new Redis({ username: "nomonitor", password: "123456" }).monitor()
    ).to.eventually.be.rejectedWith(/NOPERM/);
  });
});
