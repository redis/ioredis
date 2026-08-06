import { expect } from "chai";
import {
  isPrivateAddress,
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
});
