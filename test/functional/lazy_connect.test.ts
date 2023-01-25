import { describe, expect, it, jest } from "@jest/globals";
import { Cluster } from "../../lib";
import Pipeline from "../../lib/Pipeline";
import Redis from "../../lib/Redis";

describe("lazy connect", () => {
  it("should not call `connect` when init", () => {
    const mocked = jest
      .spyOn(Redis.prototype, "connect")
      .mockImplementation(() => Promise.resolve());

    new Redis({ lazyConnect: true });
    expect(mocked).not.toHaveBeenCalled();
  });

  it("should connect when calling a command", async () => {
    const redis = new Redis({ lazyConnect: true });
    redis.set("foo", "bar");
    expect(await redis.get("foo")).toEqual("bar");
  });

  it("should not try to reconnect when disconnected manually", (done) => {
    const redis = new Redis({ lazyConnect: true });
    redis.get("foo", () => {
      redis.disconnect();
      redis.get("foo", function (err) {
        expect(err?.message).toMatch(/Connection is closed/);
        done();
      });
    });
  });

  it("should be able to disconnect", (done) => {
    const redis = new Redis({ lazyConnect: true });
    redis.on("end", () => {
      done();
    });
    redis.disconnect();
  });

  describe("Cluster", () => {
    it("should not call `connect` when init", () => {
      const mocked = jest
        .spyOn(Cluster.prototype, "connect")
        .mockImplementation(() => Promise.resolve());

      new Cluster([], { lazyConnect: true });
      expect(mocked).not.toHaveBeenCalled();
    });

    it("should call connect when pipeline exec", () => {
      const mocked = jest
        .spyOn(Cluster.prototype, "connect")
        .mockImplementation(() => Promise.resolve());
      const cluster = new Cluster([], { lazyConnect: true });
      const pipeline = new Pipeline(cluster);
      pipeline.get("fool1").exec(() => {});
      expect(mocked).toHaveBeenCalled();
    });

    it("should call connect when transaction exec", () => {
      const mocked = jest
        .spyOn(Cluster.prototype, "connect")
        .mockImplementation(() => Promise.resolve());
      const cluster = new Cluster([], { lazyConnect: true });
      cluster
        .multi()
        .get("fool1")
        .exec(() => {});
      expect(mocked).toHaveBeenCalled();
    });

    it('should quit before "close" being emitted', (done) => {
      const mocked = jest
        .spyOn(Cluster.prototype, "connect")
        .mockImplementation(() => Promise.resolve());

      const cluster = new Cluster([], { lazyConnect: true });
      cluster.quit(() => {
        cluster.once("close", () => {
          cluster.once("end", () => {
            expect(mocked).not.toHaveBeenCalled();
            done();
          });
        });
      });
    });

    it('should disconnect before "close" being emitted', (done) => {
      const mocked = jest
        .spyOn(Cluster.prototype, "connect")
        .mockImplementation(() => Promise.resolve());

      const cluster = new Cluster([], { lazyConnect: true });
      cluster.disconnect();
      cluster.once("close", () => {
        cluster.once("end", () => {
          expect(mocked).not.toHaveBeenCalled();
          done();
        });
      });
    });

    it("should support disconnecting with reconnect", (done) => {
      const mocked = jest
        .spyOn(Cluster.prototype, "connect")
        .mockImplementation(() => Promise.resolve());

      const cluster = new Cluster([], {
        lazyConnect: true,
        clusterRetryStrategy: () => {
          return 1;
        },
      });
      cluster.disconnect(true);
      cluster.once("close", () => {
        mocked.mockRestore();
        jest.spyOn(Cluster.prototype, "connect").mockImplementation(() => {
          done();
          return Promise.resolve();
        });
      });
    });
  });
});
