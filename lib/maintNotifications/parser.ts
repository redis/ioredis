import { isIP } from "net";
import { Debug } from "../utils";
import {
  MaintenanceNotificationType,
  type MaintenanceEndpoint,
  type MaintenanceNotification,
} from "./types";

const debug = Debug("maintenance");

const maintenanceNotificationTypes = new Set<MaintenanceNotificationType>(
  Object.values(MaintenanceNotificationType)
);

export function parseMaintenanceNotification(
  push: unknown,
  parsedType?: string
): MaintenanceNotification | null {
  if (!Array.isArray(push) || push.length === 0) {
    return null;
  }

  const type = parsedType ?? parseString(push[0]);
  if (!type || !isMaintenanceNotificationType(type)) {
    return null;
  }

  const notification = parseKnownNotification(type, push);
  if (!notification) {
    debug('ignore malformed maintenance push "%s"', type);
  }
  return notification;
}

function parseKnownNotification(
  type: MaintenanceNotificationType,
  push: unknown[]
): MaintenanceNotification | null {
  const sequenceNumber = parseInteger(push[1]);
  if (sequenceNumber === null) {
    return null;
  }

  switch (type) {
    case MaintenanceNotificationType.MOVING: {
      if (push.length !== 3 && push.length !== 4) {
        return null;
      }
      const timeSeconds = parseInteger(push[2]);
      const endpoint =
        push.length === 3 ? null : parseMaintenanceEndpoint(push[3]);
      if (timeSeconds === null || endpoint === undefined) {
        return null;
      }
      return { type, sequenceNumber, timeSeconds, endpoint };
    }
    case MaintenanceNotificationType.MIGRATING:
    case MaintenanceNotificationType.FAILING_OVER: {
      if (push.length !== 3) {
        return null;
      }
      const timeSeconds = parseInteger(push[2]);
      if (timeSeconds === null) {
        return null;
      }
      return { type, sequenceNumber, timeSeconds };
    }
    case MaintenanceNotificationType.MIGRATED:
    case MaintenanceNotificationType.FAILED_OVER: {
      if (push.length !== 2) {
        return null;
      }
      return { type, sequenceNumber };
    }
  }
}

function isMaintenanceNotificationType(
  value: string
): value is MaintenanceNotificationType {
  return maintenanceNotificationTypes.has(value as MaintenanceNotificationType);
}

function parseString(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString();
  }
  return null;
}

function parseInteger(value: unknown): number | null {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else {
    const stringValue = parseString(value);
    if (!stringValue || !/^-?\d+$/.test(stringValue)) {
      return null;
    }
    parsed = Number(stringValue);
  }

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseMaintenanceEndpoint(
  value: unknown
): MaintenanceEndpoint | null | undefined {
  if (value === null) {
    return null;
  }

  const endpoint = parseString(value);
  if (!endpoint) {
    return undefined;
  }

  if (endpoint.startsWith("[")) {
    const match = /^\[([^\]]+)\]:(\d+)$/.exec(endpoint);
    if (!match || isIP(match[1]) !== 6) {
      return undefined;
    }
    const port = parsePort(match[2]);
    return port === null ? undefined : { host: match[1], port };
  }

  const separator = endpoint.lastIndexOf(":");
  if (separator <= 0 || separator === endpoint.length - 1) {
    return undefined;
  }

  const host = endpoint.slice(0, separator);
  const port = parsePort(endpoint.slice(separator + 1));
  if (port === null || !isValidHost(host)) {
    return undefined;
  }
  return { host, port };
}

function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function isValidHost(host: string): boolean {
  if (isIP(host) !== 0) {
    return true;
  }
  if (/^[\d.]+$/.test(host)) {
    return false;
  }
  if (host.length > 253 || host.endsWith(".")) {
    return false;
  }
  return host
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)
    );
}
