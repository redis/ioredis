import { Debug } from "../utils";
import {
  MaintenanceNotificationType,
  type MaintenanceNotification,
} from "./types";
import {
  CommandTimeoutDuringMaintenanceError,
  SocketTimeoutDuringMaintenanceError,
} from "../errors";

const debug = Debug("maintenance");

/**
 * Windows normally close when the server sends the matching end notification
 * (MIGRATED / FAILED_OVER). The caps below only guard against an end
 * notification that never arrives; the values follow the operation durations
 * suggested in the HLD (10 minutes for a shard migration, 1 minute for a
 * shard failover).
 */
export const MIGRATING_WINDOW_CAP_MS = 10 * 60 * 1000;
export const FAILING_OVER_WINDOW_CAP_MS = 60 * 1000;

/**
 * MOVING has no end notification. The server hard-closes the connection when
 * the grace period communicated in the notification is over, so the window
 * expires on its own shortly after that deadline.
 */
export const MOVING_WINDOW_MARGIN_MS = 2000;

type MaintenanceWindowType =
  | typeof MaintenanceNotificationType.MIGRATING
  | typeof MaintenanceNotificationType.FAILING_OVER
  | typeof MaintenanceNotificationType.MOVING;

export interface TimeoutPolicy {
  timeout: number;
  createTimeoutError: () => Error;
}

/**
 * The mechanisms the manager drives on the client. Kept structural so the
 * manager stays independent of the Redis class and trivially testable.
 */
export interface MaintenanceClient {
  options: {
    commandTimeout?: number;
    socketTimeout?: number;
    maintRelaxedCommandTimeout?: number;
    maintRelaxedSocketTimeout?: number;
  };
  extendPendingCommandTimeouts(
    timeout: number,
    createTimeoutError: () => Error
  ): void;
  rearmSocketTimeout(): void;
  flushOfflineQueue(): void;
}

/**
 * Owns the client-side Smart Client Handoff state: maintenance windows
 * announced through RESP3 push notifications, the timeout policy that
 * applies while they are open, and the handoff write pause.
 *
 * A window opens on MIGRATING, FAILING_OVER, or MOVING and closes on the
 * matching end notification, on its deadline, or when the connection drops.
 */
export default class MaintenanceManager {
  private readonly windows = new Map<MaintenanceWindowType, NodeJS.Timeout>();
  private writePause: symbol | null = null;

  constructor(private readonly client: MaintenanceClient) {}

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

  /**
   * The relaxed command timeout that applies while maintenance is active, or
   * null when the normal timeout applies.
   */
  commandTimeoutPolicy(): TimeoutPolicy | null {
    if (!this.isMaintenanceActive()) {
      return null;
    }

    const timeout = Math.max(
      this.client.options.commandTimeout ?? 0,
      this.client.options.maintRelaxedCommandTimeout ?? 0
    );
    if (timeout <= 0) {
      return null;
    }

    return {
      timeout,
      createTimeoutError: () =>
        new CommandTimeoutDuringMaintenanceError(timeout),
    };
  }

  /**
   * The relaxed socket timeout that applies while maintenance is active, or
   * null when the normal timeout applies.
   */
  socketTimeoutPolicy(): TimeoutPolicy | null {
    if (!this.isMaintenanceActive()) {
      return null;
    }

    const timeout = Math.max(
      this.client.options.socketTimeout ?? 0,
      this.client.options.maintRelaxedSocketTimeout ?? 0
    );
    if (timeout <= 0) {
      return null;
    }

    return {
      timeout,
      createTimeoutError: () =>
        new SocketTimeoutDuringMaintenanceError(timeout),
    };
  }

  /**
   * Pauses writes for a Smart Client Handoff. While paused, submitted
   * commands are retained in the offline queue instead of being written to
   * the connection. Returns a token that must be presented to resume writes;
   * only one handoff may be active at a time.
   */
  pauseWrites(): symbol {
    if (this.writePause) {
      throw new Error("A connection handoff is already in progress");
    }

    debug("pause writes for connection handoff");
    return (this.writePause = Symbol("sch-handoff"));
  }

  /**
   * Resumes writes after a handoff settles and replays the offline queue.
   * A stale token (from a handoff that was already superseded or cleaned up
   * by a disconnect) is ignored, so late asynchronous cleanup cannot unpause
   * a newer handoff.
   */
  resumeWrites(token: symbol): void {
    if (this.writePause !== token) {
      debug("ignore resume with a stale handoff token");
      return;
    }

    debug("resume writes after connection handoff");
    this.writePause = null;
    this.client.flushOfflineQueue();
  }

  isWritePaused(): boolean {
    return this.writePause !== null;
  }

  /**
   * Clears every window and any write pause. Invoked when the connection
   * closes: if maintenance is still ongoing, the server re-sends the pending
   * notification on the next connection, and the ordinary reconnect path
   * replays the offline queue.
   */
  reset(): void {
    this.windows.forEach((timer) => clearTimeout(timer));
    this.windows.clear();
    this.writePause = null;
  }

  /**
   * A repeated start notification refreshes the window instead of stacking:
   * the server replaces its pending notification, so the latest deadline wins.
   */
  private openWindow(type: MaintenanceWindowType, maxDurationMs: number): void {
    debug("open %s window for up to %dms", type, maxDurationMs);
    const wasActive = this.isMaintenanceActive();
    this.clearTimer(type);
    const timer = setTimeout(() => {
      debug("%s window expired", type);
      this.windows.delete(type);
    }, maxDurationMs);
    timer.unref?.();
    this.windows.set(type, timer);

    if (!wasActive) {
      this.relaxTimeouts();
    }
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

  /**
   * Invoked when the first window opens. In-flight commands get their
   * deadlines extended to the relaxed timeout (never shortened) and a
   * pending socket timeout is re-armed with the relaxed value. New commands
   * and future socket arms consult the timeout policies themselves, which
   * also restores normal policy once the windows close.
   */
  private relaxTimeouts(): void {
    try {
      const policy = this.commandTimeoutPolicy();
      if (policy && typeof this.client.options.commandTimeout === "number") {
        this.client.extendPendingCommandTimeouts(
          policy.timeout,
          policy.createTimeoutError
        );
      }

      this.client.rearmSocketTimeout();
    } catch (err) {
      debug("failed to relax timeouts: %s", err);
    }
  }
}
