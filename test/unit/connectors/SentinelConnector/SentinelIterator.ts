import { expect } from "chai";
import SentinelIterator from "../../../../lib/connectors/SentinelConnector/SentinelIterator";

describe("SentinelIterator", () => {
  it("keeps cloned subscription traversal separate from discovery", () => {
    const iter = new SentinelIterator([
      { port: 30001 },
      { port: 30002 },
      { port: 30003 },
    ]);
    iter.next();
    iter.next();

    const subscriptions = iter.clone();
    subscriptions.reset(true);
    subscriptions.add({ port: 30004 });

    expect(subscriptions.next().value.port).to.equal(30002);
    expect(iter.next().value.port).to.equal(30003);
    expect(iter.next().done).to.equal(true);
  });

  it("continues from the cursor and wraps after the last sentinel", () => {
    const iter = new SentinelIterator([
      { port: 30001 },
      { port: 30002 },
      { port: 30003 },
    ]);
    iter.next();
    iter.rotateToCursor();

    expect(iter.next().value.port).to.equal(30002);
    expect(iter.next().value.port).to.equal(30003);
    expect(iter.next().value.port).to.equal(30001);

    iter.rotateToCursor();
    expect(iter.next().value.port).to.equal(30002);
  });

  it("keep the options immutable", () => {
    function getSentinels() {
      return [{ host: "127.0.0.1", port: 30001 }];
    }
    const sentinels = getSentinels();

    const iter = new SentinelIterator(sentinels);
    iter.add({ host: "127.0..0.1", port: 30002 });

    expect(sentinels).to.eql(getSentinels());
    expect(iter.next().value.port).to.eql(30001);
    expect(iter.next().value.port).to.eql(30002);
  });
});
