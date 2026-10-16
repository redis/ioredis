import { expect } from "chai";
import SentinelIterator from "../../../../lib/connectors/SentinelConnector/SentinelIterator";

describe("SentinelIterator", () => {
  it("continues from the cursor and wraps around without mutating the options", () => {
    const sentinels = [30001, 30002, 30003].map((port) => ({ port }));
    const iter = new SentinelIterator(sentinels);

    iter.rotateToCursor();
    expect(iter.next().value.port).to.equal(30001);

    iter.rotateToCursor();
    expect(iter.next().value.port).to.equal(30002);
    expect(iter.next().value.port).to.equal(30003);
    expect(iter.next().value.port).to.equal(30001);
    expect(iter.next().done).to.equal(true);

    iter.rotateToCursor();
    expect(iter.next().value.port).to.equal(30002);
    expect(sentinels.map((sentinel) => sentinel.port)).to.deep.equal([
      30001, 30002, 30003,
    ]);
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
