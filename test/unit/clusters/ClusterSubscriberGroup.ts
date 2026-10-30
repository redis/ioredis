import { expect } from "chai";
import { EventEmitter } from "events";
import * as sinon from "sinon";
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
});
