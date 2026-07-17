import { expect } from "chai";
import Redis from "../../lib/Redis";
import { Cluster } from "../../lib";

/**
 * Tests for duplicate() respecting subclasses (#2053).
 *
 * Before the fix, `redis.duplicate()` hardcoded `new Redis(...)` and the
 * applyMixin helper was copying EventEmitter.prototype.constructor onto
 * Redis.prototype — so `redis.constructor` resolved to EventEmitter. As a
 * result, subclasses were not preserved on duplicate().
 *
 * These tests verify observable behavior and should remain valid under
 * future refactors.
 */
describe("duplicate() with subclasses (#2053)", () => {
  describe("Redis", () => {
    it("should resolve this.constructor to Redis (applyMixin fix)", () => {
      const redis = new Redis({ lazyConnect: true });
      expect(redis.constructor).to.equal(Redis);
      expect(redis.constructor.name).to.equal("Redis");
      redis.disconnect();
    });

    it("should return a Redis instance when duplicate() is called on Redis", () => {
      const redis = new Redis({ lazyConnect: true });
      const dup = redis.duplicate();
      expect(dup).to.be.instanceOf(Redis);
      expect(dup.constructor).to.equal(Redis);
      redis.disconnect();
      dup.disconnect();
    });

    it("should return a subclass instance when duplicate() is called on a subclass", () => {
      class MyRedis extends Redis {}

      const redis = new MyRedis({ lazyConnect: true });
      const dup = redis.duplicate();

      expect(dup).to.be.instanceOf(MyRedis);
      expect(dup).to.be.instanceOf(Redis);
      expect(dup.constructor).to.equal(MyRedis);
      redis.disconnect();
      dup.disconnect();
    });

    it("should preserve subclass methods across duplicate()", () => {
      class InstrumentedRedis extends Redis {
        getInstrumentationTag() {
          return "instrumented";
        }
      }

      const redis = new InstrumentedRedis({ lazyConnect: true });
      const dup = redis.duplicate();

      expect((dup as InstrumentedRedis).getInstrumentationTag()).to.equal(
        "instrumented"
      );
      redis.disconnect();
      dup.disconnect();
    });

    it("should preserve subclass fields set in constructor", () => {
      class TaggedRedis extends Redis {
        readonly tag: string;
        constructor(options: any) {
          super(options);
          this.tag = "my-tag";
        }
      }

      const redis = new TaggedRedis({ lazyConnect: true });
      const dup = redis.duplicate() as TaggedRedis;

      expect(dup.tag).to.equal("my-tag");
      redis.disconnect();
      dup.disconnect();
    });

    it("should apply override options to the duplicate", () => {
      class MyRedis extends Redis {}

      const redis = new MyRedis({ lazyConnect: true, db: 0 });
      const dup = redis.duplicate({ db: 3 });

      expect(dup).to.be.instanceOf(MyRedis);
      expect(dup.options.db).to.equal(3);
      redis.disconnect();
      dup.disconnect();
    });

    it("should work with deeply-nested subclass hierarchies", () => {
      class A extends Redis {}
      class B extends A {}
      class C extends B {}

      const redis = new C({ lazyConnect: true });
      const dup = redis.duplicate();

      expect(dup).to.be.instanceOf(C);
      expect(dup).to.be.instanceOf(B);
      expect(dup).to.be.instanceOf(A);
      expect(dup).to.be.instanceOf(Redis);
      expect(dup.constructor).to.equal(C);
      redis.disconnect();
      dup.disconnect();
    });
  });

  describe("Cluster", () => {
    it("should resolve this.constructor to Cluster", () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
        lazyConnect: true,
      });
      expect(cluster.constructor).to.equal(Cluster);
      expect(cluster.constructor.name).to.equal("Cluster");
      cluster.disconnect();
    });

    it("should return a Cluster instance when duplicate() is called on Cluster", () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
        lazyConnect: true,
      });
      const dup = cluster.duplicate();
      expect(dup).to.be.instanceOf(Cluster);
      cluster.disconnect();
      dup.disconnect();
    });

    it("should return a subclass instance when duplicate() is called on a subclass", () => {
      class MyCluster extends Cluster {}

      const cluster = new MyCluster([{ host: "127.0.0.1", port: 30001 }], {
        lazyConnect: true,
      });
      const dup = cluster.duplicate();

      expect(dup).to.be.instanceOf(MyCluster);
      expect(dup).to.be.instanceOf(Cluster);
      cluster.disconnect();
      dup.disconnect();
    });

    it("should preserve subclass methods across duplicate()", () => {
      class InstrumentedCluster extends Cluster {
        getInstrumentationTag() {
          return "cluster-instrumented";
        }
      }

      const cluster = new InstrumentedCluster(
        [{ host: "127.0.0.1", port: 30001 }],
        { lazyConnect: true }
      );
      const dup = cluster.duplicate();

      expect((dup as InstrumentedCluster).getInstrumentationTag()).to.equal(
        "cluster-instrumented"
      );
      cluster.disconnect();
      dup.disconnect();
    });
  });

  describe("applyMixin", () => {
    it("should not overwrite Redis.prototype.constructor with EventEmitter", () => {
      expect(Redis.prototype.constructor).to.equal(Redis);
    });

    it("should not overwrite Cluster.prototype.constructor with EventEmitter", () => {
      expect(Cluster.prototype.constructor).to.equal(Cluster);
    });

    it("should still mix in EventEmitter methods onto Redis", () => {
      const redis = new Redis({ lazyConnect: true });
      expect(typeof redis.on).to.equal("function");
      expect(typeof redis.emit).to.equal("function");
      expect(typeof redis.removeAllListeners).to.equal("function");
      redis.disconnect();
    });

    it("should still mix in EventEmitter methods onto Cluster", () => {
      const cluster = new Cluster([{ host: "127.0.0.1", port: 30001 }], {
        lazyConnect: true,
      });
      expect(typeof cluster.on).to.equal("function");
      expect(typeof cluster.emit).to.equal("function");
      expect(typeof cluster.removeAllListeners).to.equal("function");
      cluster.disconnect();
    });
  });
});
