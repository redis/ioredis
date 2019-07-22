import { expect } from "chai";
import SentinelIterator from "../../../../lib/connectors/SentinelConnector/SentinelIterator";

describe("SentinelIterator", () => {
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
