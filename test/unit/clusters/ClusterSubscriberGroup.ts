import { expect } from "chai";
import { EventEmitter } from "events";
import * as sinon from "sinon";
import { ReplyError } from "redis-errors";
import ClusterSubscriberGroup from "../../../lib/cluster/ClusterSubscriberGroup";
import Redis from "../../../lib/Redis";

describe("ClusterSubscriberGroup", () => {
  it("removes every copy of a channel with equal bytes", () => {
    const group = new ClusterSubscriberGroup(new EventEmitter(), {});
    group.addChannels(["news{tag}", Buffer.from("news{tag}")]);
    group.addChannels([Buffer.from("news{tag}"), "control{tag}"]);

    expect(group.removeChannels([Buffer.from("news{tag}")])).to.equal(1);
    expect(group.removeChannels(["control{tag}"])).to.equal(0);
  });

  it("keeps distinct binary channels even when their UTF-8 strings match", () => {
    const group = new ClusterSubscriberGroup(new EventEmitter(), {});
    const first = Buffer.concat([Buffer.from("{tag}"), Buffer.from([0xfe])]);
    const second = Buffer.concat([Buffer.from("{tag}"), Buffer.from([0xff])]);
    expect(first.toString()).to.equal(second.toString());
    group.addChannels([first, second]);

    expect(group.removeChannels([Buffer.from(first)])).to.equal(1);
    expect(group.removeChannels([first])).to.equal(1);
    expect(group.removeChannels([Buffer.from(second)])).to.equal(0);
  });

  it("keeps channels unchanged when an unsubscribe spans slots", () => {
    const group = new ClusterSubscriberGroup(new EventEmitter(), {});
    group.addChannels([Buffer.from("news{tag}")]);

    expect(group.removeChannels(["news{tag}", "news{other}"])).to.equal(-1);
    expect(group.removeChannels(["news{tag}"])).to.equal(0);
  });

  describe("connect backoff", () => {
    afterEach(() => {
      sinon.restore();
    });

    it("keeps growing when a start is cut short by stop", async () => {
      const connect = sinon.stub(Redis.prototype, "connect");
      connect.onCall(0).rejects(new Error("connect failed"));
      connect.onCall(1).returns(new Promise<void>(() => {}));
      connect.onCall(2).rejects(new Error("connect failed"));

      const emitter = new EventEmitter();
      const delays: number[] = [];
      emitter.on("subscriberConnectFailed", ({ delay }) => delays.push(delay));

      const group = new ClusterSubscriberGroup(emitter, {});
      group.addChannels(["news{tag}"]);
      const slots = new Array(16384).fill(["127.0.0.1:30001"]);
      const nodes = [{ options: { host: "127.0.0.1", port: 30001 } }];

      await group.reset(slots, nodes);
      expect(delays, "first failure").to.have.length(1);

      const hungReset = group.reset(slots, nodes);
      await new Promise((resolve) => setImmediate(resolve));
      expect(connect.callCount, "second start is pending").to.equal(2);
      group.stop();
      await hungReset;

      await group.reset(slots, nodes);
      expect(connect.callCount, "third start ran").to.equal(3);
      expect(delays, "second failure").to.have.length(2);
      expect(delays[1], "second backoff step").to.be.at.least(300);
    });
  });

  describe("resubscribe retry", () => {
    const NODE = "127.0.0.1:30001";
    const slots = new Array(16384).fill([NODE]);
    const nodes = [{ options: { host: "127.0.0.1", port: 30001 } }];
    const realSetImmediate = setImmediate;
    const flushPromises = () =>
      new Promise((resolve) => realSetImmediate(resolve));
    const moved = () => new ReplyError(`MOVED 1 ${NODE}`);

    let clock: sinon.SinonFakeTimers;
    let ssubscribe: sinon.SinonStub;
    let retries: sinon.SinonSpy;
    let emitter: EventEmitter;
    let group: ClusterSubscriberGroup;

    beforeEach(() => {
      // A started subscriber is ready at once, so a reset resubscribes it
      // without waiting for a "ready" event.
      sinon.stub(Redis.prototype, "connect").callsFake(function (this: Redis) {
        this.status = "ready";
        return Promise.resolve();
      });
      ssubscribe = sinon.stub(Redis.prototype, "ssubscribe");
      // No jitter: attempt n waits exactly min(100 * 2^n, 2000) ms.
      sinon.stub(Math, "random").returns(0.5);
      clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      emitter = new EventEmitter();
      retries = sinon.spy();
      emitter.on("resubscribeRetry", retries);
      group = new ClusterSubscriberGroup(emitter, {});
    });

    afterEach(() => {
      group.stop();
      clock.restore();
      sinon.restore();
    });

    // Resets with an unchanged topology and lets resubscribe replies settle.
    const reset = async () => {
      await group.reset(slots, nodes);
      await flushPromises();
    };

    // Fires the only pending timer and returns how long it waited.
    const fireRetry = () => {
      expect(clock.countTimers(), "pending retry timers").to.equal(1);
      const before = clock.now;
      clock.next();
      return clock.now - before;
    };

    it("retries a transient failure after a backoff and stops once it succeeds", async () => {
      ssubscribe.onCall(0).rejects(moved());
      ssubscribe.resolves(1);
      group.addChannels(["news{tag}"]);

      await reset();
      expect(ssubscribe.callCount, "first resubscribe").to.equal(1);

      clock.tick(199);
      expect(retries.called, "retried before the backoff").to.equal(false);
      clock.tick(1);
      expect(retries.callCount, "retried after the backoff").to.equal(1);

      await reset();
      expect(ssubscribe.callCount, "resubscribed by the retry").to.equal(2);
      expect(ssubscribe.lastCall.args).to.eql(["news{tag}"]);
      expect(clock.countTimers(), "timers after success").to.equal(0);

      await reset();
      expect(ssubscribe.callCount, "resubscribed again after success").to.equal(
        2
      );
    });

    it("grows the backoff while the resubscribe keeps failing", async () => {
      ssubscribe.rejects(moved());
      group.addChannels(["news{tag}"]);
      await reset();

      const delays: number[] = [];
      for (let attempt = 0; attempt < 6; attempt++) {
        delays.push(fireRetry());
        await reset();
      }

      expect(delays).to.eql([200, 400, 800, 1600, 2000, 2000]);
      expect(ssubscribe.callCount).to.equal(7);
    });

    it("does not resubscribe on a refresh that is not the retry", async () => {
      ssubscribe.rejects(moved());
      group.addChannels(["news{tag}"]);
      await reset();

      // The MOVED reply also triggers a slots refresh before the retry is
      // due. It must not resubscribe, or each MOVED would start another one.
      await reset();
      await reset();

      expect(ssubscribe.callCount).to.equal(1);
      expect(clock.countTimers(), "retry still pending").to.equal(1);
    });

    it("schedules one retry for several failed slots", async () => {
      ssubscribe.rejects(moved());
      group.addChannels(["news{a}"]);
      group.addChannels(["news{b}"]);
      await reset();

      expect(ssubscribe.callCount, "one resubscribe per slot").to.equal(2);
      expect(fireRetry(), "backoff of the first attempt").to.equal(200);
      expect(retries.callCount).to.equal(1);
    });

    for (const message of ["Command timed out", "Connection is closed."]) {
      it(`does not retry a local error: ${message}`, async () => {
        const errors = sinon.spy();
        emitter.on("resubscribeError", errors);
        ssubscribe.rejects(new Error(message));
        group.addChannels(["news{tag}"]);

        await reset();
        clock.tick(10_000);

        expect(clock.countTimers(), "pending timers").to.equal(0);
        expect(retries.called, "retried").to.equal(false);
        expect(errors.called, "reported").to.equal(false);
      });
    }

    it("cancels a pending retry on stop", async () => {
      ssubscribe.rejects(moved());
      group.addChannels(["news{tag}"]);
      await reset();

      group.stop();
      clock.tick(10_000);

      expect(clock.countTimers()).to.equal(0);
      expect(retries.called).to.equal(false);
    });

    it("cancels a pending retry on sunsubscribeAll", async () => {
      sinon.stub(Redis.prototype, "sunsubscribe").resolves(0);
      ssubscribe.rejects(moved());
      group.addChannels(["news{tag}"]);
      await reset();

      await group.sunsubscribeAll();
      clock.tick(10_000);

      expect(clock.countTimers()).to.equal(0);
      expect(retries.called).to.equal(false);
    });

    it("cancels a pending retry once the failed slot has no channels left", async () => {
      ssubscribe.rejects(moved());
      group.addChannels(["news{tag}"]);
      await reset();

      group.removeChannels(["news{tag}"]);
      clock.tick(10_000);

      expect(clock.countTimers()).to.equal(0);
      expect(retries.called).to.equal(false);
    });

    it("keeps the retry while another failed slot still has channels", async () => {
      ssubscribe.rejects(moved());
      group.addChannels(["news{a}"]);
      group.addChannels(["news{b}"]);
      await reset();

      group.removeChannels(["news{a}"]);

      expect(fireRetry(), "backoff of the first attempt").to.equal(200);
      await reset();
      expect(ssubscribe.lastCall.args, "retried slot").to.eql(["news{b}"]);
    });

    it("ignores a failure for a slot whose channels were removed meanwhile", async () => {
      let rejectSsubscribe!: (err: Error) => void;
      ssubscribe.returns(
        new Promise((_, reject) => {
          rejectSsubscribe = reject;
        })
      );
      group.addChannels(["news{tag}"]);
      await reset();

      group.removeChannels(["news{tag}"]);
      rejectSsubscribe(moved());
      await flushPromises();

      expect(clock.countTimers()).to.equal(0);
      expect(retries.called).to.equal(false);
    });
  });
});
