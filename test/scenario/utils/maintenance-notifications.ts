import * as diagnostics_channel from "node:diagnostics_channel";
import type { MaintenanceNotification } from "../../../lib/maintNotifications";

export const MAINTENANCE_CHANNEL = "ioredis:maintenance";

export interface MaintenanceStartWait {
  notification: Promise<MaintenanceNotification>;
  stop: () => void;
}

/**
 * Subscribes before an effect starts and resolves when the client publishes a
 * maintenance-start notification. The caller must stop the subscription in a
 * finally block so setup failures cannot leak it into the next trigger run.
 */
export const createMaintenanceStartWait = (
  timeoutMs = 120_000
): MaintenanceStartWait => {
  let settled = false;
  let timer: ReturnType<typeof setTimeout>;
  let resolveNotification: (notification: MaintenanceNotification) => void;
  let rejectNotification: (error: Error) => void;

  const notification = new Promise<MaintenanceNotification>(
    (resolve, reject) => {
      resolveNotification = resolve;
      rejectNotification = reject;
    }
  );
  const onNotification = (message: unknown) => {
    const notification = message as MaintenanceNotification;
    if (
      notification.type !== "MIGRATING" &&
      notification.type !== "FAILING_OVER" &&
      notification.type !== "MOVING"
    ) {
      return;
    }

    stop();
    resolveNotification(notification);
  };
  const stop = () => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    diagnostics_channel.unsubscribe(MAINTENANCE_CHANNEL, onNotification);
  };

  diagnostics_channel.subscribe(MAINTENANCE_CHANNEL, onNotification);
  timer = setTimeout(() => {
    stop();
    rejectNotification(
      new Error(`Timed out waiting for a maintenance notification`)
    );
  }, timeoutMs);
  timer.unref?.();

  return { notification, stop };
};
