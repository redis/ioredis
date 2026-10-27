import Redis from "../../lib/Redis";
import { expect } from "chai";

describe("select", function () {
  it("should support auto select", (done) => {
    const redis = new Redis({ db: 2 });
    redis.set("foo", "2");
    redis.select("2");
    redis.get("foo", function (err, res) {
      expect(res).to.eql("2");
      redis.disconnect();
      done();
    });
  });

  it("should resend commands to the correct db", (done) => {
    const redis = new Redis();
    redis.once("ready", function () {
      redis.set("foo", "2", function () {
        redis.stream.destroy();
        redis.select("3");
        redis.set("foo", "3");
        redis.select("0");
        redis.get("foo", function (err, res) {
          expect(res).to.eql("2");
          redis.select("3");
          redis.get("foo", function (err, res) {
            expect(res).to.eql("3");
            redis.disconnect();
            done();
          });
        });
      });
    });
  });

  it("should re-select the current db when reconnect", (done) => {
    const redis = new Redis();

    redis.once("ready", function () {
      redis.set("foo", "bar");
      redis.select(2);
      redis.set("foo", "2", function () {
        redis.stream.destroy();
        redis.get("foo", function (err, res) {
          expect(res).to.eql("2");
          redis.disconnect();
          done();
        });
      });
    });
  });

  it("should keep the selected db for commands issued while connecting", async () => {
    const redis = new Redis({ db: 2 });
    await redis.select(0);

    const issued = new Promise<string>((resolve, reject) => {
      redis.once("connecting", () => {
        redis.client("INFO").then(resolve, reject);
      });
    });
    redis.stream.destroy();

    expect(await issued).to.match(/\bdb=0\b/);
    redis.disconnect();
  });

  it("should keep a db selected while connecting", async () => {
    const redis = new Redis();
    await redis.select(2);

    const ready = new Promise<void>((resolve) => {
      redis.once("connecting", () => {
        redis.select(5);
        redis.once("ready", resolve);
      });
    });
    redis.stream.destroy();

    await ready;

    expect(await redis.client("INFO")).to.match(/\bdb=5\b/);
    redis.disconnect();
  });

  it('should emit "select" event when db changes', (done) => {
    const changes = [];
    const redis = new Redis();
    redis.on("select", function (db) {
      changes.push(db);
    });
    redis.select("2", function () {
      expect(changes).to.eql([2]);
      redis.select("4", function () {
        expect(changes).to.eql([2, 4]);
        redis.select("4", function () {
          expect(changes).to.eql([2, 4]);
          redis.disconnect();
          done();
        });
      });
    });
  });

  it('should re-select a db chosen with call("SELECT") when reconnecting', async () => {
    const redis = new Redis();
    await redis.call("SELECT", 2);

    redis.stream.destroy();
    await new Promise<void>((resolve) => redis.once("ready", resolve));

    expect(await redis.client("INFO")).to.match(/\bdb=2\b/);
    redis.disconnect();
  });

  it("should be sent on the connect event", (done) => {
    const redis = new Redis({ db: 2 });
    const select = redis.select;
    redis.select = function () {
      return select.apply(redis, arguments).then(function () {
        redis.select = select;
        redis.disconnect();
        done();
      });
    };
    redis.on("connect", function () {
      redis.info();
    });
  });

  it("should not switch db when a WATCHed transaction is discarded", async () => {
    const redis = new Redis();
    const other = new Redis();
    await redis.set("watched", "v1");
    await redis.watch("watched");
    await other.set("watched", "v2");

    const exec = await redis.multi().select(1).set("in-tx", "1").exec();
    expect(exec).to.eql(null);

    await redis.set("after", "db0-value");
    redis.stream.destroy();
    await new Promise<void>((resolve) => redis.once("ready", resolve));

    // The SELECT was queued, never applied: the reconnect must not select db 1.
    expect(await redis.client("INFO")).to.match(/\bdb=0\b/);
    expect(await redis.get("after")).to.eql("db0-value");

    redis.disconnect();
    other.disconnect();
  });

  it("should not switch db when EXEC aborts the transaction", async () => {
    const redis = new Redis();
    // SET without a value is rejected while queueing, so EXEC aborts.
    let error: Error | undefined;
    try {
      await redis.multi().select(1).set("only-key").exec();
    } catch (err) {
      error = err as Error;
    }
    expect(error).to.be.an.instanceOf(Error);
    expect(error?.message).to.contain("EXECABORT");

    await redis.set("marker", "db0");
    redis.stream.destroy();
    await new Promise<void>((resolve) => redis.once("ready", resolve));

    expect(await redis.client("INFO")).to.match(/\bdb=0\b/);
    expect(await redis.get("marker")).to.eql("db0");

    redis.disconnect();
  });

  it("should switch db once the transaction runs", async () => {
    const redis = new Redis();
    await redis.multi().select(2).set("in-tx", "1").exec();
    redis.stream.destroy();
    await new Promise<void>((resolve) => redis.once("ready", resolve));

    expect(await redis.client("INFO")).to.match(/\bdb=2\b/);
    expect(await redis.get("in-tx")).to.eql("1");

    redis.disconnect();
  });

  it("should not switch db when a manual transaction is discarded", async () => {
    const redis = new Redis();
    const other = new Redis();
    await redis.set("watched", "v1");
    await redis.watch("watched");
    await other.set("watched", "v2");

    await redis.multi({ pipeline: false });
    await redis.select(1);
    await redis.set("in-tx", "1");
    const exec = await redis.exec();
    expect(exec).to.eql(null);

    await redis.set("after", "db0-value");
    redis.stream.destroy();
    await new Promise<void>((resolve) => redis.once("ready", resolve));
    expect(await redis.get("after")).to.eql("db0-value");

    redis.disconnect();
    other.disconnect();
  });
});
