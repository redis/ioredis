import { Debug } from "../utils";
import {
  MaintenanceNotificationType,
  type MaintenanceNotification,
  type MovingNotification,
} from "./types";
import {
  CommandTimeoutDuringMaintenanceError,
  SocketTimeoutDuringMaintenanceError,
} from "../errors";
import type {
  DetachedTransport,
  HandoffCandidate,
  HandoffEndpoint,
} from "../redis/ConnectionSession";

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
  canHandoffConnection(): boolean;
  getConfiguredEndpoint(): HandoffEndpoint | null;
  createCandidateConnection(
    endpoint: HandoffEndpoint
  ): Promise<HandoffCandidate>;
  adoptTransport(transport: DetachedTransport, endpoint: HandoffEndpoint): void;
  waitForCommandQueueToDrain(): Promise<void>;
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
  // Scheduled handoff to the configured endpoint for an endpointless MOVING.
  private movingReconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly client: MaintenanceClient) {}

  handle = (notification: MaintenanceNotification): void => {
    debug("received notification %o", notification);
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
        this.handleMoving(notification);
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
    this.clearMovingReconnectTimer();
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
      if (!this.isMaintenanceActive()) {
        this.restoreSocketTimeout();
      }
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
    if (!this.isMaintenanceActive()) {
      this.restoreSocketTimeout();
    }
  }

  private clearTimer(type: MaintenanceWindowType): void {
    const timer = this.windows.get(type);
    if (timer) {
      clearTimeout(timer);
    }
  }

  /**
   * MOVING opens a relaxation window like the other notifications and, when
   * the connection shape allows it, starts a Smart Client Handoff to the
   * announced endpoint.
   */
  private handleMoving(notification: MovingNotification): void {
    this.openWindow(
      MaintenanceNotificationType.MOVING,
      notification.timeSeconds * 1000 + MOVING_WINDOW_MARGIN_MS
    );
    // A newer MOVING supersedes any transition scheduled by a previous one.
    this.clearMovingReconnectTimer();

    const graceMs = notification.timeSeconds * 1000;
    if (!notification.endpoint) {
      this.scheduleEndpointlessHandoff(graceMs);
      return;
    }
    if (this.isWritePaused()) {
      debug("a handoff is already in progress; ignoring MOVING");
      return;
    }
    if (!this.client.canHandoffConnection()) {
      debug(
        "connection does not support a handoff; relying on ordinary reconnect"
      );
      return;
    }

    void this.performHandoff(notification.endpoint, graceMs);
  }

  /**
   * An endpointless MOVING asks the client to move back to its configured
   * endpoint, whose DNS record is being repointed. Wait half the grace
   * period (giving DNS time to flip) and then hand off proactively while
   * the old endpoint is still serving, rather than waiting for the abrupt
   * server-side close at the deadline. If the handoff cannot run or fails,
   * that hard-close remains the backstop through the ordinary reconnect
   * path.
   */
  private scheduleEndpointlessHandoff(graceMs: number): void {
    const delayMs = Math.floor(graceMs / 2);
    debug(
      "MOVING carries no endpoint; scheduling a handoff to the configured endpoint in %dms",
      delayMs
    );
    const timer = setTimeout(() => {
      this.movingReconnectTimer = null;
      if (this.isWritePaused()) {
        debug("a handoff is already in progress; skipping the scheduled one");
        return;
      }
      if (!this.client.canHandoffConnection()) {
        debug(
          "connection does not support a handoff; relying on the server-side disconnect"
        );
        return;
      }
      const endpoint = this.client.getConfiguredEndpoint();
      if (!endpoint) {
        debug(
          "no configured endpoint to hand off to; relying on the server-side disconnect"
        );
        return;
      }
      void this.performHandoff(endpoint, graceMs - delayMs);
    }, delayMs);
    timer.unref?.();
    this.movingReconnectTimer = timer;
  }

  private clearMovingReconnectTimer(): void {
    if (this.movingReconnectTimer) {
      clearTimeout(this.movingReconnectTimer);
      this.movingReconnectTimer = null;
    }
  }

  /**
   * The sequential handoff: pause writes, connect the replacement and drain
   * the old connection in parallel, then atomically adopt the replacement
   * and replay the paused commands. On any failure the old connection keeps
   * (or regains) ownership: writes resume if it is still healthy, and if it
   * is gone, the close path has already cleared the pause so the ordinary
   * reconnect replays the offline queue.
   */
  private async performHandoff(
    endpoint: HandoffEndpoint,
    graceMs: number
  ): Promise<void> {
    let token: symbol;
    try {
      token = this.pauseWrites();
    } catch {
      return;
    }

    debug(
      "start connection handoff to %s:%d (grace %dms)",
      endpoint.host,
      endpoint.port,
      graceMs
    );
    const candidatePromise = this.client.createCandidateConnection(endpoint);

    try {
      const [candidate] = await this.withGraceDeadline(
        Promise.all([
          candidatePromise,
          this.client.waitForCommandQueueToDrain(),
        ]),
        graceMs
      );

      // The old connection may have dropped while the candidate was
      // connecting; the close path then cleared this pause and the ordinary
      // reconnect owns the client. A stale handoff must not adopt.
      if (this.writePause !== token) {
        throw new Error("Connection handoff was superseded by a reconnect");
      }

      // Throws if the candidate connection died while the old connection
      // was draining, so a dead transport is never adopted.
      const transport = candidate.detachTransport();
      this.client.adoptTransport(transport, endpoint);
      // Relaxed timeouts return to normal as soon as the handoff completes.
      this.closeWindow(MaintenanceNotificationType.MOVING);
      this.resumeWrites(token);
      debug(
        "connection handoff to %s:%d complete",
        endpoint.host,
        endpoint.port
      );
    } catch (err) {
      debug("connection handoff failed: %s", err);
      // The candidate was not adopted: dispose it now, or whenever it
      // finishes connecting.
      candidatePromise.then(
        (candidate) => candidate.dispose(),
        () => {}
      );
      this.resumeWrites(token);
    }
  }

  private withGraceDeadline<T>(
    promise: Promise<T>,
    graceMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(`Connection handoff was not completed within ${graceMs}ms`)
        );
      }, graceMs);
      timer.unref?.();
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  /**
   * Invoked when the first window opens. In-flight commands get their
   * deadlines extended to the relaxed timeout (never shortened) and a
   * pending socket timeout is re-armed with the relaxed value. New commands
   * and future socket arms consult the timeout policies themselves.
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

  /**
   * Invoked when the last window closes. Existing commands keep the timeout
   * assigned to them during maintenance, while a pending socket timeout is
   * re-armed with the normal value.
   */
  private restoreSocketTimeout(): void {
    debug("all windows closed; restoring normal socket timeout");
    try {
      this.client.rearmSocketTimeout();
    } catch (err) {
      debug("failed to restore socket timeout: %s", err);
    }
  }
}
