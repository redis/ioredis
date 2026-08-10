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
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(address), address).to.eql(true);
    }

    for (const address of ["8.8.8.8", "100.128.0.1", "2001:4860::8888"]) {
      expect(isPrivateAddress(address), address).to.eql(false);
    }
  });

  it("resolves auto endpoint types from address and TLS", async () => {
    expect(await resolveMaintEndpointType("auto", "10.0.0.1", false)).to.eql(
      "internal-ip"
    );
    expect(await resolveMaintEndpointType("auto", "10.0.0.1", true)).to.eql(
      "internal-fqdn"
    );
    expect(await resolveMaintEndpointType("auto", "8.8.8.8", false)).to.eql(
      "external-ip"
    );
    expect(await resolveMaintEndpointType("auto", "8.8.8.8", true)).to.eql(
      "external-fqdn"
    );
    expect(await resolveMaintEndpointType("auto", "localhost", false)).to.eql(
      "internal-ip"
    );
  });

  it("preserves explicit endpoint types", async () => {
    expect(await resolveMaintEndpointType("none", "10.0.0.1", false)).to.eql(
      "none"
    );
    expect(
      await resolveMaintEndpointType("external-fqdn", "10.0.0.1", false)
    ).to.eql("external-fqdn");
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
        ["MIGRATED", "not-a-number"],
        ["MIGRATED", 1, "unexpected"],
        ["FAILING_OVER", 1],
        ["FAILING_OVER", 1, -1],
        ["FAILED_OVER"],
        ["FAILED_OVER", 1, "unexpected"],
      ]) {
        expect(parseMaintenanceNotification(push), JSON.stringify(push)).to.eql(
          null
        );
      }
    });
  });
});
