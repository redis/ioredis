import { Debug } from "../utils";
import {
  MaintenanceNotificationType,
  type MaintenanceNotification,
} from "./types";
import type Redis from "../Redis";

const debug = Debug("maintenance");

// Windows normally close when the server sends the matching end notification
// (MIGRATED / FAILED_OVER). The caps below only guard against an end
// notification that never arrives; the values follow the operation durations
// suggested in the HLD (10 minutes for a shard migration, 1 minute for a
// shard failover).
export const MIGRATING_WINDOW_CAP_MS = 10 * 60 * 1000;
export const FAILING_OVER_WINDOW_CAP_MS = 60 * 1000;

// MOVING has no end notification. The server hard-closes the connection when
// the grace period communicated in the notification is over, so the window
// expires on its own shortly after that deadline.
export const MOVING_WINDOW_MARGIN_MS = 2000;

type MaintenanceWindowType =
  | typeof MaintenanceNotificationType.MIGRATING
  | typeof MaintenanceNotificationType.FAILING_OVER
  | typeof MaintenanceNotificationType.MOVING;

/**
 * Tracks server maintenance windows announced through RESP3 push
 * notifications. A window opens on MIGRATING, FAILING_OVER, or MOVING and
 * closes on the matching end notification, on its deadline, or when the
 * connection drops.
 */
export default class MaintenanceManager {
  private readonly windows = new Map<MaintenanceWindowType, NodeJS.Timeout>();

  constructor(redis: Redis) {
    // A dropped connection implicitly ends every window: if maintenance is
    // still ongoing, the server re-sends the pending notification on the
    // next connection.
    redis.on("close", () => this.reset());
  }

  handle = (notification: MaintenanceNotification): void => {
    switch (notification.type) {
      case MaintenanceNotificationType.MIGRATING:
        this.openWindow(notification.type, MIGRATING_WINDOW_CAP_MS);
        break;
      case MaintenanceNotificationType.MIGRATED:
        this.closeWindow(MaintenanceNotificationType.MIGRATING);
        break;
      case MaintenanceNotificationType.FAILING_OVER:
        this.openWindow(notification.type, FAILING_OVER_WINDOW_CAP_MS);
        break;
      case MaintenanceNotificationType.FAILED_OVER:
        this.closeWindow(MaintenanceNotificationType.FAILING_OVER);
        break;
      case MaintenanceNotificationType.MOVING:
        this.openWindow(
          notification.type,
          notification.timeSeconds * 1000 + MOVING_WINDOW_MARGIN_MS
        );
        break;
    }
  };

  isMaintenanceActive(): boolean {
    return this.windows.size > 0;
  }

  reset(): void {
    this.windows.forEach((timer) => clearTimeout(timer));
    this.windows.clear();
  }

  // A repeated start notification refreshes the window instead of stacking:
  // the server replaces its pending notification, so the latest deadline wins.
  private openWindow(type: MaintenanceWindowType, maxDurationMs: number): void {
    debug("open %s window for up to %dms", type, maxDurationMs);
    this.clearTimer(type);
    const timer = setTimeout(() => {
      debug("%s window expired", type);
      this.windows.delete(type);
    }, maxDurationMs);
    timer.unref?.();
    this.windows.set(type, timer);
  }

  private closeWindow(type: MaintenanceWindowType): void {
    if (!this.windows.has(type)) {
      return;
    }
    debug("close %s window", type);
    this.clearTimer(type);
    this.windows.delete(type);
  }

  private clearTimer(type: MaintenanceWindowType): void {
    const timer = this.windows.get(type);
    if (timer) {
      clearTimeout(timer);
    }
  }
}
