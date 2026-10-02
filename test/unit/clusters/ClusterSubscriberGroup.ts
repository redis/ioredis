import { expect } from "chai";
import { EventEmitter } from "events";
import ClusterSubscriberGroup from "../../../lib/cluster/ClusterSubscriberGroup";

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
});
