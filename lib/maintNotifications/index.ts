import { isIP } from "net";
import { noop } from "../utils";
import type { HandshakeCommand } from "../redis/event_handler";

export { parseMaintenanceNotification } from "./parser";
export { MaintenanceNotificationType } from "./types";
export type {
  FailedOverNotification,
  FailingOverNotification,
  MaintenanceEndpoint,
  MaintenanceNotification,
  MigratedNotification,
  MigratingNotification,
  MovingNotification,
} from "./types";

export type MaintNotifications = "auto" | "enabled" | "disabled";

export type MaintEndpointType =
  | "auto"
  | "internal-ip"
  | "internal-fqdn"
  | "external-ip"
  | "external-fqdn"
  | "none";

export type ResolvedMaintEndpointType = Exclude<MaintEndpointType, "auto">;

function isPrivateIPv4(address: string): boolean {
  const octets = address.split(".").map(Number);

  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
  );
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedIPv4Prefix = "::ffff:";
  if (normalized.startsWith(mappedIPv4Prefix)) {
    const mappedAddress = normalized.slice(mappedIPv4Prefix.length);
    if (isIP(mappedAddress) === 4) {
      return isPrivateIPv4(mappedAddress);
    }
  }

  const version = isIP(normalized);
  if (version === 4) {
    return isPrivateIPv4(normalized);
  }
  if (version === 6) {
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }
  return false;
}

export function resolveMaintEndpointType(
  endpointType: MaintEndpointType,
  address: string | undefined,
  tlsEnabled: boolean
): ResolvedMaintEndpointType {
  if (endpointType !== "auto") {
    return endpointType;
  }

  const internal = address ? isPrivateAddress(address) : false;
  if (tlsEnabled) {
    return internal ? "internal-fqdn" : "external-fqdn";
  }
  return internal ? "internal-ip" : "external-ip";
}

export function getMaintNotificationsHandshakeCommand(
  redis: any
): HandshakeCommand | null {
  if (redis.options.maintNotifications === "disabled") {
    return null;
  }

  if (redis.condition.protocol !== 3) {
    return null;
  }

  let address = redis.stream?.remoteAddress;
  if (!address && isIP(redis.options.host)) {
    address = redis.options.host;
  }

  const endpointType = resolveMaintEndpointType(
    redis.options.maintEndpointType,
    address,
    Boolean(redis.options.tls)
  );

  return {
    kind: "maint_notifications",
    send: () =>
      redis.client(
        "MAINT_NOTIFICATIONS",
        "ON",
        "moving-endpoint-type",
        endpointType
      ),
    errorHandler:
      redis.options.maintNotifications === "auto" ? noop : undefined,
  };
}
