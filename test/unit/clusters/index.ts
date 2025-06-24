import { nodeKeyToRedisOptions } from "../../../lib/cluster/util";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";
import { expect } from "chai";

describe("cluster", () => {
  let stub: sinon.SinonStub | undefined;
  beforeEach(() => {
    stub = sinon.stub(Cluster.prototype, "connect");
    stub.callsFake(() => Promise.resolve());
  });

  afterEach(() => {
    if (stub) stub.restore();
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
      // @ts-expect-error
      new Cluster([{}], { scaleReads: "invalid" });
    }).to.throw(/Invalid option scaleReads/);
  });

  it("disables slotsRefreshTimeout by default", () => {
    const cluster = new Cluster([{}]);
    expect(cluster.options.slotsRefreshInterval).to.eql(undefined);
  });

  describe("#nodes()", () => {
    it("throws when role is invalid", () => {
      const cluster = new Cluster([{}]);
      expect(() => {
        // @ts-expect-error
        cluster.nodes("invalid");
      }).to.throw(/Invalid role/);
    });
  });


  describe("natMapper", () => {
    it("returns the original nodeKey if no NAT mapping is provided", () => {
      const cluster = new Cluster([]);
      const nodeKey = { host: "127.0.0.1", port: 6379 };
      const result = cluster["natMapper"](nodeKey);

      expect(result).to.eql(nodeKey);
    });

    it("maps external IP to internal IP using NAT mapping object", () => {
      const natMap = { "203.0.113.1:6379": { host: "127.0.0.1", port: 30000 } };
      const cluster = new Cluster([], { natMap });
      const nodeKey = "203.0.113.1:6379";
      const result = cluster["natMapper"](nodeKey);
      expect(result).to.eql({ host: "127.0.0.1", port: 30000 });
    });

    it("maps external IP to internal IP using NAT mapping function", () => {
      const natMap = (key) => {
        if (key === "203.0.113.1:6379") {
          return { host: "127.0.0.1", port: 30000 };
        }
        return null;
      };
      const cluster = new Cluster([], { natMap });
      const nodeKey = "203.0.113.1:6379";
      const result = cluster["natMapper"](nodeKey);
      expect(result).to.eql({ host: "127.0.0.1", port: 30000 });
    });

    it("returns the original nodeKey if NAT mapping is invalid", () => {
      const natMap = { "invalid:key": { host: "127.0.0.1", port: 30000 } };
      const cluster = new Cluster([], { natMap });
      const nodeKey = "203.0.113.1:6379";
      const result = cluster["natMapper"](nodeKey);
      expect(result).to.eql({ host: "203.0.113.1", port: 6379 });
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
