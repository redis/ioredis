import { nodeKeyToRedisOptions } from "../../../lib/cluster/util";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";
import { expect } from "chai";

describe("cluster", () => {
  beforeEach(() => {
    sinon.stub(Cluster.prototype, "connect").callsFake(() => Promise.resolve());
  });

  afterEach(() => {
    Cluster.prototype.connect.restore();
  });

  it("should support frozen options", () => {
    const options = Object.freeze({ maxRedirections: 1000 });
    const cluster = new Cluster([{ port: 7777 }], options);
    expect(cluster.options).to.have.property("maxRedirections", 1000);
    expect(cluster.options).to.have.property("scaleReads", "master");
  });

  it("should allow overriding Commander options", () => {
    const cluster = new Cluster([{ port: 7777 }], {
      showFriendlyErrorStack: true,
    });
    expect(cluster.options).to.have.property("showFriendlyErrorStack", true);
  });

  it("should support passing keyPrefix via redisOptions", () => {
    const cluster = new Cluster([{ port: 7777 }], {
      redisOptions: { keyPrefix: "prefix:" },
    });
    expect(cluster.options).to.have.property("keyPrefix", "prefix:");
  });

  it("throws when scaleReads is invalid", () => {
    expect(() => {
      new Cluster([{}], { scaleReads: "invalid" });
    }).to.throw(/Invalid option scaleReads/);
  });

  describe("#nodes()", () => {
    it("throws when role is invalid", () => {
      const cluster = new Cluster([{}]);
      expect(() => {
        cluster.nodes("invalid");
      }).to.throw(/Invalid role/);
    });
  });
});

describe("nodeKeyToRedisOptions()", () => {
  it("returns correct result", () => {
    expect(nodeKeyToRedisOptions("127.0.0.1:6379")).to.eql({
      port: 6379,
      host: "127.0.0.1",
    });
    expect(nodeKeyToRedisOptions("192.168.1.1:30001")).to.eql({
      port: 30001,
      host: "192.168.1.1",
    });
    expect(nodeKeyToRedisOptions("::0:6379")).to.eql({
      port: 6379,
      host: "::0",
    });
    expect(nodeKeyToRedisOptions("0:0:6379")).to.eql({
      port: 6379,
      host: "0:0",
    });
  });
});
