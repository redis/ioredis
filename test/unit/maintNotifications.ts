import { expect } from "chai";
import {
  isPrivateAddress,
  parseMaintenanceNotification,
  resolveMaintEndpointType,
} from "../../lib/maintNotifications";

describe("maintenance", () => {
  it("recognizes internal address ranges", () => {
    for (const address of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "::ffff:10.0.0.1",
      "::ffff:127.0.0.1",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(address), address).to.eql(true);
    }

    for (const address of [
      "8.8.8.8",
      "100.128.0.1",
      "::ffff:8.8.8.8",
      "2001:4860::8888",
    ]) {
      expect(isPrivateAddress(address), address).to.eql(false);
    }
  });

  it("resolves auto endpoint types from the connected address and TLS", () => {
    expect(resolveMaintEndpointType("auto", "10.0.0.1", false)).to.eql(
      "internal-ip"
    );
    expect(resolveMaintEndpointType("auto", "10.0.0.1", true)).to.eql(
      "internal-fqdn"
    );
    expect(resolveMaintEndpointType("auto", "8.8.8.8", false)).to.eql(
      "external-ip"
    );
    expect(resolveMaintEndpointType("auto", "8.8.8.8", true)).to.eql(
      "external-fqdn"
    );
    expect(resolveMaintEndpointType("auto", undefined, false)).to.eql(
      "external-ip"
    );
  });

  it("preserves explicit endpoint types", () => {
    expect(resolveMaintEndpointType("none", "10.0.0.1", false)).to.eql("none");
    expect(resolveMaintEndpointType("external-fqdn", "10.0.0.1", false)).to.eql(
      "external-fqdn"
    );
  });

  describe("parseMaintenanceNotification", () => {
    it("parses MOVING with Buffer and string scalars", () => {
      expect(
        parseMaintenanceNotification([
          Buffer.from("MOVING"),
          Buffer.from("17"),
          "15",
          Buffer.from("cache.internal:6380"),
        ])
      ).to.eql({
        type: "MOVING",
        sequenceNumber: 17,
        timeSeconds: 15,
        endpoint: { host: "cache.internal", port: 6380 },
      });
    });

    it("parses MIGRATING", () => {
      expect(
        parseMaintenanceNotification(["MIGRATING", 18, Buffer.from("30")])
      ).to.eql({
        type: "MIGRATING",
        sequenceNumber: 18,
        timeSeconds: 30,
      });
    });

    it("parses MIGRATED", () => {
      expect(
        parseMaintenanceNotification([Buffer.from("MIGRATED"), "19"])
      ).to.eql({
        type: "MIGRATED",
        sequenceNumber: 19,
      });
    });

    it("parses FAILING_OVER", () => {
      expect(
        parseMaintenanceNotification(["FAILING_OVER", Buffer.from("20"), 30])
      ).to.eql({
        type: "FAILING_OVER",
        sequenceNumber: 20,
        timeSeconds: 30,
      });
    });

    it("parses FAILED_OVER", () => {
      expect(
        parseMaintenanceNotification([Buffer.from("FAILED_OVER"), 21])
      ).to.eql({
        type: "FAILED_OVER",
        sequenceNumber: 21,
      });
    });

    it("parses shard ids from start and end notifications", () => {
      expect(
        parseMaintenanceNotification([
          "MIGRATING",
          18,
          "30",
          Buffer.from('["1","2"]'),
        ])
      ).to.eql({
        type: "MIGRATING",
        sequenceNumber: 18,
        timeSeconds: 30,
        shardIds: ["1", "2"],
      });
      expect(parseMaintenanceNotification(["MIGRATED", 19, "[3,4]"])).to.eql({
        type: "MIGRATED",
        sequenceNumber: 19,
        shardIds: ["3", "4"],
      });
      expect(
        parseMaintenanceNotification(["FAILING_OVER", 20, 30, '["5"]'])
      ).to.eql({
        type: "FAILING_OVER",
        sequenceNumber: 20,
        timeSeconds: 30,
        shardIds: ["5"],
      });
      expect(parseMaintenanceNotification(["FAILED_OVER", 21, "[6]"])).to.eql({
        type: "FAILED_OVER",
        sequenceNumber: 21,
        shardIds: ["6"],
      });
    });

    it("keeps notifications with unparseable shard ids", () => {
      expect(
        parseMaintenanceNotification(["MIGRATING", 18, 30, "not-json"])
      ).to.eql({
        type: "MIGRATING",
        sequenceNumber: 18,
        timeSeconds: 30,
      });
      expect(
        parseMaintenanceNotification(["MIGRATED", 19, '{"not":"an-array"}'])
      ).to.eql({
        type: "MIGRATED",
        sequenceNumber: 19,
      });
      expect(parseMaintenanceNotification(["FAILED_OVER", 21, null])).to.eql({
        type: "FAILED_OVER",
        sequenceNumber: 21,
      });
    });

    it("parses IPv4, IPv6, and null MOVING endpoints", () => {
      expect(
        parseMaintenanceNotification(["MOVING", 1, 15, "10.0.0.8:6379"])
      ).to.have.nested.property("endpoint.host", "10.0.0.8");
      expect(
        parseMaintenanceNotification(["MOVING", 2, 15, "2001:db8::8:6380"])
      ).to.have.nested.property("endpoint.host", "2001:db8::8");
      expect(
        parseMaintenanceNotification(["MOVING", 3, 15, "[2001:db8::9]:6380"])
      ).to.have.nested.property("endpoint.host", "2001:db8::9");
      expect(
        parseMaintenanceNotification(["MOVING", 4, 15, null])
      ).to.have.property("endpoint", null);
      expect(parseMaintenanceNotification(["MOVING", 5, 15])).to.have.property(
        "endpoint",
        null
      );
    });

    it("ignores unknown and malformed notifications", () => {
      for (const push of [
        ["FUTURE_EVENT", 1],
        ["MOVING", 1],
        ["MOVING", -1, 15, "cache.internal:6380"],
        ["MOVING", 1, -1, "cache.internal:6380"],
        ["MOVING", 1, 15, "cache.internal:70000"],
        ["MIGRATING", 1],
        ["MIGRATING", 1, null],
        ["MIGRATING", 1, 30, '["1"]', "unexpected"],
        ["MIGRATED", "not-a-number"],
        ["MIGRATED", 1, '["1"]', "unexpected"],
        ["FAILING_OVER", 1],
        ["FAILING_OVER", 1, -1],
        ["FAILED_OVER"],
        ["FAILED_OVER", 1, '["1"]', "unexpected"],
      ]) {
        expect(parseMaintenanceNotification(push), JSON.stringify(push)).to.eql(
          null
        );
      }
    });
  });
});
