import { expect } from "chai";
import * as sinon from "sinon";
import MaintenanceManager, {
  FAILING_OVER_WINDOW_CAP_MS,
  MIGRATING_WINDOW_CAP_MS,
  MOVING_WINDOW_MARGIN_MS,
} from "../../lib/maintNotifications/MaintenanceManager";
import type { MaintenanceNotification } from "../../lib/maintNotifications";

const notification = (partial: Partial<MaintenanceNotification>) =>
  ({ sequenceNumber: 1, ...partial } as MaintenanceNotification);

const createClientMock = () => ({
  options: {} as Record<string, number | undefined>,
  extendPendingCommandTimeouts: sinon.spy(),
  rearmSocketTimeout: sinon.spy(),
  flushOfflineQueue: sinon.spy(),
});

describe("MaintenanceManager", () => {
  let clock: sinon.SinonFakeTimers;
  let client: ReturnType<typeof createClientMock>;
  let manager: MaintenanceManager;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    client = createClientMock();
    manager = new MaintenanceManager(client as any);
  });

  afterEach(() => {
    clock.restore();
  });

  it("opens a window on MIGRATING and closes it on MIGRATED", () => {
    expect(manager.isMaintenanceActive()).to.equal(false);

    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    expect(manager.isMaintenanceActive()).to.equal(true);

    manager.handle(notification({ type: "MIGRATED" }));
    expect(manager.isMaintenanceActive()).to.equal(false);
  });

  it("opens a window on FAILING_OVER and closes it on FAILED_OVER", () => {
    manager.handle(notification({ type: "FAILING_OVER", timeSeconds: 10 }));
    expect(manager.isMaintenanceActive()).to.equal(true);

    manager.handle(notification({ type: "FAILED_OVER" }));
    expect(manager.isMaintenanceActive()).to.equal(false);
  });

  it("ignores end notifications without an open window", () => {
    manager.handle(notification({ type: "MIGRATED" }));
    manager.handle(notification({ type: "FAILED_OVER" }));

    expect(manager.isMaintenanceActive()).to.equal(false);
  });

  it("tracks overlapping windows independently per type", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.handle(notification({ type: "FAILING_OVER", timeSeconds: 10 }));

    manager.handle(notification({ type: "FAILED_OVER" }));
    expect(manager.isMaintenanceActive()).to.equal(true);

    manager.handle(notification({ type: "MIGRATED" }));
    expect(manager.isMaintenanceActive()).to.equal(false);
  });

  it("expires an unclosed MIGRATING window at its cap", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    clock.tick(MIGRATING_WINDOW_CAP_MS - 1);
    expect(manager.isMaintenanceActive()).to.equal(true);

    clock.tick(1);
    expect(manager.isMaintenanceActive()).to.equal(false);
  });

  it("expires an unclosed FAILING_OVER window at its cap", () => {
    manager.handle(notification({ type: "FAILING_OVER", timeSeconds: 10 }));

    clock.tick(FAILING_OVER_WINDOW_CAP_MS - 1);
    expect(manager.isMaintenanceActive()).to.equal(true);

    clock.tick(1);
    expect(manager.isMaintenanceActive()).to.equal(false);
  });

  it("refreshes the window when a start notification repeats", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    clock.tick(MIGRATING_WINDOW_CAP_MS - 1);

    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    clock.tick(MIGRATING_WINDOW_CAP_MS - 1);
    expect(manager.isMaintenanceActive()).to.equal(true);

    clock.tick(1);
    expect(manager.isMaintenanceActive()).to.equal(false);
  });

  it("expires a MOVING window shortly after its grace period", () => {
    manager.handle(
      notification({
        type: "MOVING",
        timeSeconds: 15,
        endpoint: { host: "10.0.0.1", port: 6379 },
      })
    );

    clock.tick(15 * 1000 + MOVING_WINDOW_MARGIN_MS - 1);
    expect(manager.isMaintenanceActive()).to.equal(true);

    clock.tick(1);
    expect(manager.isMaintenanceActive()).to.equal(false);
  });

  it("clears every window on reset", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.handle(notification({ type: "FAILING_OVER", timeSeconds: 10 }));
    manager.handle(
      notification({ type: "MOVING", timeSeconds: 15, endpoint: null })
    );

    manager.reset();

    expect(manager.isMaintenanceActive()).to.equal(false);
  });

  it("relaxes timeouts only when the first window opens", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.handle(notification({ type: "FAILING_OVER", timeSeconds: 10 }));
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    expect(client.rearmSocketTimeout.calledOnce).to.equal(true);
  });

  it("relaxes timeouts again when a window opens after all closed", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.handle(notification({ type: "MIGRATED" }));

    manager.handle(notification({ type: "FAILING_OVER", timeSeconds: 10 }));

    expect(client.rearmSocketTimeout.calledTwice).to.equal(true);
  });

  it("extends pending command deadlines when commandTimeout is configured", () => {
    client.options.commandTimeout = 100;
    client.options.maintRelaxedCommandTimeout = 5000;

    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    expect(client.extendPendingCommandTimeouts.calledOnce).to.equal(true);
    expect(client.extendPendingCommandTimeouts.firstCall.args[0]).to.equal(
      5000
    );
  });

  it("does not extend deadlines without a configured commandTimeout", () => {
    client.options.maintRelaxedCommandTimeout = 5000;

    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    expect(client.extendPendingCommandTimeouts.called).to.equal(false);
  });

  it("survives a throwing client while relaxing timeouts", () => {
    client.rearmSocketTimeout = sinon.stub().throws(new Error("boom"));

    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    expect(manager.isMaintenanceActive()).to.equal(true);
  });

  it("computes relaxed timeout policies while maintenance is active", () => {
    client.options.commandTimeout = 100;
    client.options.maintRelaxedCommandTimeout = 5000;
    client.options.socketTimeout = 200;
    client.options.maintRelaxedSocketTimeout = 6000;

    expect(manager.commandTimeoutPolicy()).to.equal(null);
    expect(manager.socketTimeoutPolicy()).to.equal(null);

    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    expect(manager.commandTimeoutPolicy()?.timeout).to.equal(5000);
    expect(manager.socketTimeoutPolicy()?.timeout).to.equal(6000);
    expect(manager.commandTimeoutPolicy()?.createTimeoutError().name).to.equal(
      "CommandTimeoutDuringMaintenanceError"
    );
    expect(manager.socketTimeoutPolicy()?.createTimeoutError().name).to.equal(
      "SocketTimeoutDuringMaintenanceError"
    );

    manager.handle(notification({ type: "MIGRATED" }));

    expect(manager.commandTimeoutPolicy()).to.equal(null);
    expect(manager.socketTimeoutPolicy()).to.equal(null);
  });

  it("never relaxes below the configured timeouts", () => {
    client.options.commandTimeout = 10_000;
    client.options.maintRelaxedCommandTimeout = 500;

    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    expect(manager.commandTimeoutPolicy()?.timeout).to.equal(10_000);
  });

  it("pauses and resumes writes with a token", () => {
    expect(manager.isWritePaused()).to.equal(false);

    const token = manager.pauseWrites();
    expect(manager.isWritePaused()).to.equal(true);
    expect(() => manager.pauseWrites()).to.throw(
      "A connection handoff is already in progress"
    );

    manager.resumeWrites(Symbol("stale"));
    expect(manager.isWritePaused()).to.equal(true);
    expect(client.flushOfflineQueue.called).to.equal(false);

    manager.resumeWrites(token);
    expect(manager.isWritePaused()).to.equal(false);
    expect(client.flushOfflineQueue.calledOnce).to.equal(true);
  });

  it("clears the write pause on reset", () => {
    manager.pauseWrites();

    manager.reset();

    expect(manager.isWritePaused()).to.equal(false);
    expect(client.flushOfflineQueue.called).to.equal(false);
  });
});
