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

describe("MaintenanceManager", () => {
  let clock: sinon.SinonFakeTimers;
  let onMaintenanceStart: sinon.SinonSpy;
  let manager: MaintenanceManager;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    onMaintenanceStart = sinon.spy();
    manager = new MaintenanceManager({ onMaintenanceStart });
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

  it("signals only the first opened window", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.handle(notification({ type: "FAILING_OVER", timeSeconds: 10 }));
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    expect(onMaintenanceStart.calledOnce).to.equal(true);
  });

  it("signals again when a window opens after all windows closed", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.handle(notification({ type: "MIGRATED" }));

    manager.handle(notification({ type: "FAILING_OVER", timeSeconds: 10 }));

    expect(onMaintenanceStart.calledTwice).to.equal(true);
  });

  it("survives a throwing onMaintenanceStart callback", () => {
    const throwingManager = new MaintenanceManager({
      onMaintenanceStart: () => {
        throw new Error("boom");
      },
    });

    throwingManager.handle(
      notification({ type: "MIGRATING", timeSeconds: 10 })
    );

    expect(throwingManager.isMaintenanceActive()).to.equal(true);
  });
});
