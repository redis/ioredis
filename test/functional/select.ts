import Redis from "../../lib/Redis";
import { expect } from "chai";
import MockServer from "../helpers/mock_server";

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

  it("should restore a db selected by an uppercase SELECT after reconnecting", async () => {
    const dbs = new Map();
    const values = new Map();
    const server = new MockServer(28777, (argv, socket) => {
      const command = argv[0].toLowerCase();
      const db = dbs.get(socket) ?? 0;
      if (command === "select") {
        dbs.set(socket, Number(argv[1]));
        return "+OK";
      }
      if (command === "set") {
        values.set(`${db}:${argv[1]}`, argv[2]);
        return "+OK";
      }
      if (command === "get") {
        return values.get(`${db}:${argv[1]}`) ?? null;
      }
    });

    const redis = new Redis(28777);
    try {
      // Command names keep the caller's casing, so the client's db bookkeeping
      // has to match `SELECT` case-insensitively. Otherwise the reconnect
      // handshake restores the db from before this command.
      await redis.call("SELECT", 2);
      await redis.call("SET", "foo", "bar");

      redis.stream.destroy();
      await new Promise<void>((resolve) => redis.once("ready", resolve));

      expect(await redis.call("GET", "foo")).to.eql("bar");
    } finally {
      redis.disconnect();
      server.disconnect();
    }
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
});
