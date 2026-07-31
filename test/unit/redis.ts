import * as sinon from "sinon";
import { expect } from "chai";
import Redis from "../../lib/Redis";
import { DEFAULT_REDIS_OPTIONS } from "../../lib/redis/RedisOptions";

describe("Redis", () => {
  describe("constructor", () => {
    it("should parse options correctly", () => {
      const stub = sinon
        .stub(Redis.prototype, "connect")
        .returns(Promise.resolve());

      let option;
      try {
        option = getOption();
        expect(option).to.have.property("port", 6379);
        expect(option).to.have.property("host", "localhost");
        expect(option).to.have.property("family", 0);
        expect(option).to.have.property("keepAlive", 30000);

        option = getOption({ keepAlive: 1234 });
        expect(option).to.have.property("keepAlive", 1234);

        option = getOption(6380);
        expect(option).to.have.property("port", 6380);
        expect(option).to.have.property("host", "localhost");

        option = getOption("6380");
        expect(option).to.have.property("port", 6380);

        option = getOption(6381, "192.168.1.1");
        expect(option).to.have.property("port", 6381);
        expect(option).to.have.property("host", "192.168.1.1");

        option = getOption(6381, "192.168.1.1", {
          password: "123",
          db: 2,
        });
        expect(option).to.have.property("port", 6381);
        expect(option).to.have.property("host", "192.168.1.1");
        expect(option).to.have.property("password", "123");
        expect(option).to.have.property("db", 2);

        option = getOption("redis://:authpassword@127.0.0.1:6380/4");
        expect(option).to.have.property("port", 6380);
        expect(option).to.have.property("host", "127.0.0.1");
        expect(option).to.have.property("password", "authpassword");
        expect(option).to.have.property("db", 4);

        option = getOption("redis://:1+1@127.0.0.1:6380");
        expect(option).to.have.property("password", "1+1");

        option = getOption(
          `redis://127.0.0.1:6380/?password=${encodeURIComponent("1+1")}`
        );
        expect(option).to.have.property("password", "1+1");

        option = getOption("redis://127.0.0.1/");
        expect(option).to.have.property("db", 0);

        option = getOption("/tmp/redis.sock");
        expect(option).to.have.property("path", "/tmp/redis.sock");

        option = getOption({
          port: 6380,
          host: "192.168.1.1",
        });
        expect(option).to.have.property("port", 6380);
        expect(option).to.have.property("host", "192.168.1.1");

        option = getOption({
          path: "/tmp/redis.sock",
        });
        expect(option).to.have.property("path", "/tmp/redis.sock");

        option = getOption({
          port: "6380",
        });
        expect(option).to.have.property("port", 6380);

        option = getOption({
          showFriendlyErrorStack: true,
        });
        expect(option).to.have.property("showFriendlyErrorStack", true);

        option = getOption(6380, {
          host: "192.168.1.1",
        });
        expect(option).to.have.property("port", 6380);
        expect(option).to.have.property("host", "192.168.1.1");

        option = getOption("6380", {
          host: "192.168.1.1",
        });
        expect(option).to.have.property("port", 6380);

        option = getOption("rediss://host");
        expect(option).to.have.property("tls", true);

        option = getOption("rediss://example.test", {
          tls: { hostname: "example.test" },
        });
        expect(option.tls).to.deep.equal({ hostname: "example.test" });

        option = getOption("redis://localhost?family=6");
        expect(option).to.have.property("family", 6);
      } catch (err) {
        stub.restore();
        throw err;
      }
      stub.restore();

      function getOption(...args) {
        // @ts-expect-error
        const redis = new Redis(...args);
        return redis.options;
      }
    });

    it("should throw when arguments is invalid", () => {
      expect(() => {
        // @ts-expect-error
        new Redis(() => {});
      }).to.throw(Error);
    });
  });

  describe(".createClient", () => {
    it("should redirect to constructor", () => {
      const redis = Redis.createClient({ name: "pass", lazyConnect: true });
      expect(redis.options).to.have.property("name", "pass");
      expect(redis.options).to.have.property("lazyConnect", true);
    });
  });

  describe("default retryStrategy", () => {
    afterEach(() => {
      sinon.restore();
    });

    it("uses exponential backoff capped at 5000ms", () => {
      const retryStrategy = DEFAULT_REDIS_OPTIONS.retryStrategy;
      expect(retryStrategy).to.be.a("function");
      if (typeof retryStrategy !== "function") {
        throw new Error("Expected the default retryStrategy to be a function");
      }

      sinon.stub(Math, "random").returns(0);

      expect(retryStrategy(1)).to.eql(50);
      expect(retryStrategy(2)).to.eql(100);
      expect(retryStrategy(3)).to.eql(200);
      expect(retryStrategy(6)).to.eql(1600);
      expect(retryStrategy(7)).to.eql(3200);
      expect(retryStrategy(8)).to.eql(5000);
      expect(retryStrategy(20)).to.eql(5000);
    });

    it("adds up to 199ms of random jitter", () => {
      const retryStrategy = DEFAULT_REDIS_OPTIONS.retryStrategy;
      expect(retryStrategy).to.be.a("function");
      if (typeof retryStrategy !== "function") {
        throw new Error("Expected the default retryStrategy to be a function");
      }

      sinon.stub(Math, "random").returns(0.999);

      expect(retryStrategy(1)).to.eql(249);
      expect(retryStrategy(8)).to.eql(5199);
    });
  });

  describe("#end", () => {
    it("should redirect to #disconnect", (done) => {
      const redis = new Redis({ lazyConnect: true });
      const stub = sinon.stub(redis, "disconnect").callsFake(() => {
        stub.restore();
        done();
      });
      redis.end();
    });
  });

  describe("#flushQueue", () => {
    it("should flush all queues by default", () => {
      const flushQueue = Redis.prototype.flushQueue;
      const redis = {
        offlineQueue: [{ command: { reject: () => {} } }],
        commandQueue: [{ command: { reject: () => {} } }],
      };
      const offline = sinon.mock(redis.offlineQueue[0].command);
      const command = sinon.mock(redis.commandQueue[0].command);
      offline.expects("reject").once();
      command.expects("reject").once();
      flushQueue.call(redis);
      offline.verify();
      command.verify();
    });

    it("should be able to ignore a queue", () => {
      const flushQueue = Redis.prototype.flushQueue;
      const redis = {
        offlineQueue: [{ command: { reject: () => {} } }],
        commandQueue: [{ command: { reject: () => {} } }],
      };
      const offline = sinon.mock(redis.offlineQueue[0].command);
      const command = sinon.mock(redis.commandQueue[0].command);
      offline.expects("reject").once();
      command.expects("reject").never();
      flushQueue.call(redis, new Error(), { commandQueue: false });
      offline.verify();
      command.verify();
    });
  });
});
