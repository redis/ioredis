import { lookup } from "dns/promises";
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
  const version = isIP(address);
  if (version === 4) {
    return isPrivateIPv4(address);
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }
  return false;
}

async function isInternalHost(host: string): Promise<boolean> {
  if (isIP(host)) {
    return isPrivateAddress(host);
  }

  try {
    const addresses = await lookup(host, { all: true });
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => isPrivateAddress(address))
    );
  } catch {
    // A connection can use a custom resolver or an already-resolved socket even
    // when the system resolver fails here. Prefer an external endpoint in that
    // case instead of failing an otherwise healthy connection.
    return false;
  }
}

export async function resolveMaintEndpointType(
  endpointType: MaintEndpointType,
  host: string,
  tlsEnabled: boolean
): Promise<ResolvedMaintEndpointType> {
  if (endpointType !== "auto") {
    return endpointType;
  }

  const internal = await isInternalHost(host);
  if (tlsEnabled) {
    return internal ? "internal-fqdn" : "external-fqdn";
  }
  return internal ? "internal-ip" : "external-ip";
}

export async function getMaintNotificationsHandshakeCommand(
  redis: any
): Promise<HandshakeCommand | null> {
  if (redis.options.maintNotifications === "disabled") {
    return null;
  }

  if (redis.condition.protocol !== 3) {
    return null;
  }

  const endpointType = await resolveMaintEndpointType(
    redis.options.maintEndpointType,
    redis.options.host,
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
