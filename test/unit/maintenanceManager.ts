import Redis from "../../lib/Redis";
import { expect } from "chai";
import * as sinon from "sinon";
import MaintenanceManager, {
  type MaintenanceConnection,
  type MaintenanceTimeoutOptions,
  FAILING_OVER_WINDOW_CAP_MS,
  MIGRATING_WINDOW_CAP_MS,
  MOVING_WINDOW_MARGIN_MS,
} from "../../lib/maintNotifications/MaintenanceManager";
import type { MaintenanceNotification } from "../../lib/maintNotifications";

const notification = (partial: Partial<MaintenanceNotification>) =>
  ({ sequenceNumber: 1, ...partial } as MaintenanceNotification);

const createCandidateMock = () => {
  const transport = {
    stream: { destroy: sinon.spy() },
    connector: {},
    condition: {},
  };
  return {
    transport,
    detachTransport: sinon.stub().returns(transport),
    dispose: sinon.spy(),
  };
};

const createClientMock = () => ({
  options: {} as MaintenanceTimeoutOptions,
  extendPendingCommandTimeouts: sinon.spy(),
  rearmSocketTimeout: sinon.stub(),
  flushOfflineQueue: sinon.spy(),
  canHandoff: sinon.stub().returns(true),
  getConfiguredEndpoint: sinon
    .stub()
    .returns({ host: "configured.example", port: 6379 }),
  createCandidate: sinon.stub().resolves(createCandidateMock()),
  waitForDrain: sinon.stub().resolves(),
  commitHandoff: sinon.stub(),
});

describe("MaintenanceManager", () => {
  let clock: sinon.SinonFakeTimers;
  let client: ReturnType<typeof createClientMock>;
  let manager: MaintenanceManager;
  beforeEach(() => {
    clock = sinon.useFakeTimers();
    client = createClientMock();
    manager = new MaintenanceManager(client);
  });

  afterEach(() => {
    sinon.restore();
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
    client.canHandoff.returns(false);
    manager.handle(
      notification({
        type: "MOVING",
        timeSeconds: 15,
        endpoint: { host: "10.0.0.1", port: 6379 },
      }),
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
      notification({ type: "MOVING", timeSeconds: 15, endpoint: null }),
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

    // Re-armed on the first relaxation, the restoration, and the second
    // relaxation.
    expect(client.rearmSocketTimeout.callCount).to.equal(3);
  });

  it("extends pending command deadlines when commandTimeout is configured", () => {
    client.options.commandTimeout = 100;
    client.options.maintRelaxedCommandTimeout = 5000;
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    expect(client.extendPendingCommandTimeouts.calledOnce).to.equal(true);
    const policy = client.extendPendingCommandTimeouts.firstCall.args[0];
    expect(policy.timeout).to.equal(5000);
    expect(policy.createTimeoutError().name).to.equal(
      "CommandTimeoutDuringMaintenanceError",
    );
  });

  it("does not extend deadlines without a configured commandTimeout", () => {
    client.options.maintRelaxedCommandTimeout = 5000;
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    expect(client.extendPendingCommandTimeouts.called).to.equal(false);
  });

  it("reports a lost WATCH and clears maintenance on connection close", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.pauseWrites();
    expect(manager.handleConnectionClose(true)).to.equal(true);
    expect(manager.isMaintenanceActive()).to.equal(false);
    expect(manager.isWritePaused()).to.equal(false);
    expect(manager.handleConnectionClose(true)).to.equal(false);
  });

  it("does not invalidate WATCH when the closed connection was not watching", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    expect(manager.handleConnectionClose(false)).to.equal(false);
    expect(manager.isMaintenanceActive()).to.equal(false);
  });

  it("restores the socket timeout when the last window closes", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.handle(notification({ type: "MIGRATED" }));

    expect(client.rearmSocketTimeout.calledTwice).to.equal(true);
  });

  it("does not restore the socket timeout while another window is open", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.handle(notification({ type: "FAILING_OVER", timeSeconds: 10 }));

    manager.handle(notification({ type: "MIGRATED" }));
    expect(client.rearmSocketTimeout.calledOnce).to.equal(true);

    manager.handle(notification({ type: "FAILED_OVER" }));
    expect(client.rearmSocketTimeout.calledTwice).to.equal(true);
  });

  it("restores the socket timeout when the last window expires at its cap", () => {
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    clock.tick(MIGRATING_WINDOW_CAP_MS);

    expect(client.rearmSocketTimeout.calledTwice).to.equal(true);
  });

  it("survives a throwing client while relaxing timeouts", () => {
    client.rearmSocketTimeout.throws(new Error("boom"));

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
      "CommandTimeoutDuringMaintenanceError",
    );
    expect(manager.socketTimeoutPolicy()?.createTimeoutError().name).to.equal(
      "SocketTimeoutDuringMaintenanceError",
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
      "A connection handoff is already in progress",
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

  describe("connection handoff", () => {
    const endpoint = { host: "10.0.0.9", port: 6380 };
    const moving = (movingEndpoint: unknown = endpoint) =>
      notification({
        type: "MOVING",
        timeSeconds: 15,
        endpoint: movingEndpoint,
      } as Partial<MaintenanceNotification>);

    it("pauses, adopts, and resumes on a successful handoff", async () => {
      const candidate = createCandidateMock();
      client.createCandidate.resolves(candidate);

      manager.handle(moving());
      expect(manager.isWritePaused()).to.equal(true);

      await clock.tickAsync(0);

      expect(
        client.commitHandoff.calledOnceWithExactly(candidate, endpoint),
      ).to.equal(true);
      expect(candidate.detachTransport.called).to.equal(false);
      expect(
        client.commitHandoff.calledBefore(client.flushOfflineQueue),
      ).to.equal(true);
      expect(manager.isWritePaused()).to.equal(false);
      expect(client.flushOfflineQueue.calledOnce).to.equal(true);
      // The MOVING window closes as soon as the handoff completes.
      expect(manager.isMaintenanceActive()).to.equal(false);
    });

    it("adopts only after the command queue drains", async () => {
      let resolveDrain: () => void;
      client.waitForDrain.returns(
        new Promise<void>((resolve) => (resolveDrain = resolve)),
      );

      manager.handle(moving());
      await clock.tickAsync(0);
      expect(client.commitHandoff.called).to.equal(false);

      resolveDrain!();
      await clock.tickAsync(0);
      expect(client.commitHandoff.calledOnce).to.equal(true);
    });

    it("rolls back to the old connection when the candidate fails", async () => {
      client.createCandidate.rejects(new Error("connect failed"));

      manager.handle(moving());
      await clock.tickAsync(0);

      expect(client.commitHandoff.called).to.equal(false);
      expect(manager.isWritePaused()).to.equal(false);
      expect(client.flushOfflineQueue.calledOnce).to.equal(true);
      // The relaxation window stays open; the server may still disconnect.
      expect(manager.isMaintenanceActive()).to.equal(true);
    });

    it("disposes the owned candidate and resumes writes when commit is rejected", async () => {
      const candidate = createCandidateMock();
      client.createCandidate.resolves(candidate);
      client.commitHandoff.throws(new Error("Cannot adopt a transport"));
      manager.handle(moving());
      await clock.tickAsync(0);

      expect(candidate.dispose.calledOnce).to.equal(true);
      expect(candidate.detachTransport.called).to.equal(false);
      expect(client.flushOfflineQueue.calledOnce).to.equal(true);
      expect(manager.isWritePaused()).to.equal(false);
      expect(manager.isMaintenanceActive()).to.equal(true);
    });

    it("abandons the handoff at the grace deadline and disposes a late candidate", async () => {
      const candidate = createCandidateMock();
      let resolveCandidate: (candidate: unknown) => void;
      client.createCandidate.returns(
        new Promise((resolve) => (resolveCandidate = resolve)),
      );

      manager.handle(moving());
      await clock.tickAsync(15_000);

      expect(manager.isWritePaused()).to.equal(false);
      expect(client.commitHandoff.called).to.equal(false);

      resolveCandidate!(candidate);
      await clock.tickAsync(0);
      expect(candidate.dispose.calledOnce).to.equal(true);
    });

    it("hands off to the configured endpoint at half grace when MOVING has no endpoint", async () => {
      const candidate = createCandidateMock();
      client.createCandidate.resolves(candidate);
      const configured = { host: "configured.example", port: 6379 };
      client.getConfiguredEndpoint.returns(configured);

      manager.handle(moving(null));
      // Nothing happens immediately; the window is open.
      await clock.tickAsync(0);
      expect(client.createCandidate.called).to.equal(false);
      expect(manager.isMaintenanceActive()).to.equal(true);

      await clock.tickAsync(7_499);
      expect(client.createCandidate.called).to.equal(false);

      await clock.tickAsync(1);
      expect(client.createCandidate.calledOnceWithExactly(configured)).to.equal(
        true,
      );

      await clock.tickAsync(0);
      expect(
        client.commitHandoff.calledOnceWithExactly(candidate, configured),
      ).to.equal(true);
      expect(manager.isMaintenanceActive()).to.equal(false);
      expect(manager.isWritePaused()).to.equal(false);
    });

    it("cancels the scheduled endpointless handoff on reset", async () => {
      manager.handle(moving(null));

      manager.reset();
      await clock.tickAsync(60_000);

      expect(client.createCandidate.called).to.equal(false);
    });

    it("supersedes the scheduled endpointless handoff with a newer MOVING", async () => {
      manager.handle(moving(null));
      manager.handle(moving());
      await clock.tickAsync(0);

      expect(client.createCandidate.calledOnceWithExactly(endpoint)).to.equal(
        true,
      );

      // The half-grace timer never fires a second handoff.
      await clock.tickAsync(60_000);
      expect(client.createCandidate.calledOnce).to.equal(true);
    });

    it("skips the scheduled endpointless handoff when the connection shape does not allow it", async () => {
      client.canHandoff.returns(false);

      manager.handle(moving(null));
      await clock.tickAsync(10_000);

      expect(client.createCandidate.called).to.equal(false);
      // The window stays open; the server-side disconnect is the backstop.
      expect(manager.isMaintenanceActive()).to.equal(true);
    });

    it("checks current handoff eligibility when the delayed handoff starts", async () => {
      manager.handle(moving(null));
      client.canHandoff.returns(false);
      await clock.tickAsync(10_000);
      expect(client.createCandidate.called).to.equal(false);
    });

    it("skips the scheduled endpointless handoff without a configured endpoint", async () => {
      client.getConfiguredEndpoint.returns(null);

      manager.handle(moving(null));
      await clock.tickAsync(10_000);

      expect(client.createCandidate.called).to.equal(false);
      expect(manager.isMaintenanceActive()).to.equal(true);
    });

    it("skips the handoff when the connection shape does not allow it", async () => {
      client.canHandoff.returns(false);

      manager.handle(moving());
      await clock.tickAsync(0);

      expect(client.createCandidate.called).to.equal(false);
      expect(manager.isWritePaused()).to.equal(false);
    });

    it("discards the candidate when the connection drops mid-handoff", async () => {
      const candidate = createCandidateMock();
      let resolveCandidate: (candidate: unknown) => void;
      client.createCandidate.returns(
        new Promise((resolve) => (resolveCandidate = resolve)),
      );

      manager.handle(moving());
      // The close path clears the pause while the candidate is connecting.
      manager.reset();

      resolveCandidate!(candidate);
      await clock.tickAsync(0);

      expect(client.commitHandoff.called).to.equal(false);
      expect(candidate.dispose.calledOnce).to.equal(true);
      expect(manager.isWritePaused()).to.equal(false);
    });

    it("ignores MOVING while a handoff is already active", async () => {
      client.createCandidate.returns(new Promise(() => {}));

      manager.handle(moving());
      manager.handle(moving());
      await clock.tickAsync(0);

      expect(client.createCandidate.calledOnce).to.equal(true);
    });
  });
});

describe("Redis maintenance adapter", () => {
  const queue = () => {
    const extendTimeout = sinon.spy();
    return {
      length: 0,
      extendTimeout,
      toArray: () => [{ command: { extendTimeout } }],
    };
  };
  let clock: sinon.SinonFakeTimers;
  let redis: Redis;
  let owner: {
    maintenanceManager: MaintenanceManager;
    commandQueue: ReturnType<typeof queue>;
    offlineQueue: ReturnType<typeof queue>;
    socketTimeoutTimer: NodeJS.Timeout | undefined;
    armSocketTimeout(): void;
    commitHandoff: MaintenanceConnection["commitHandoff"];
  };
  let manager: MaintenanceManager;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    redis = new Redis({
      lazyConnect: true,
      commandTimeout: 100,
      maintRelaxedCommandTimeout: 5000,
    });
    owner = redis as unknown as typeof owner;
    manager = owner.maintenanceManager;
  });

  afterEach(() => {
    manager.reset();
    clearTimeout(owner.socketTimeoutTimer);
    sinon.restore();
  });

  it("extends both current queues, including replacements after a maintenance window", () => {
    const written = (owner.commandQueue = queue());
    const offline = (owner.offlineQueue = queue());
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.handle(notification({ type: "MIGRATED" }));
    const nextWritten = (owner.commandQueue = queue());
    const nextOffline = (owner.offlineQueue = queue());
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));

    for (const pending of [written, offline, nextWritten, nextOffline]) {
      expect(pending.extendTimeout.calledOnce).to.equal(true);
      expect(pending.extendTimeout.firstCall.args[0]).to.equal(5000);
      expect(pending.extendTimeout.firstCall.args[1]().name).to.equal(
        "CommandTimeoutDuringMaintenanceError",
      );
    }
  });

  it("reads current options when the owner replaces them", () => {
    redis.options = { ...redis.options, maintRelaxedCommandTimeout: 9000 };
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    expect(manager.commandTimeoutPolicy()?.timeout).to.equal(9000);
  });

  it("does not arm a socket timeout when none is pending", () => {
    const arm = sinon.spy(owner, "armSocketTimeout");
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    manager.handle(notification({ type: "MIGRATED" }));
    expect(arm.called).to.equal(false);
  });

  it("rearms the current socket timer after it is replaced", () => {
    const arm = sinon.stub(owner, "armSocketTimeout").callsFake(() => {
      expect(owner.socketTimeoutTimer).to.equal(undefined);
      owner.socketTimeoutTimer = setTimeout(() => {}, 3_600_000);
    });
    owner.socketTimeoutTimer = setTimeout(() => {}, 3_600_000);
    manager.handle(notification({ type: "MIGRATING", timeSeconds: 10 }));
    clearTimeout(owner.socketTimeoutTimer);
    const expired = sinon.spy();
    owner.socketTimeoutTimer = setTimeout(expired, 10);
    manager.handle(notification({ type: "MIGRATED" }));
    clock.tick(10);
    expect(expired.called).to.equal(false);
    expect(arm.calledTwice).to.equal(true);
  });

  for (const blockedBy of ["status", "pending replies"] as const) {
    it(`preserves candidate ownership and the old timer when commit is blocked by ${blockedBy}`, () => {
      redis.status = blockedBy === "status" ? "close" : "ready";
      owner.commandQueue = queue();
      owner.commandQueue.length = blockedBy === "pending replies" ? 1 : 0;
      const candidate = createCandidateMock();
      const expired = sinon.spy();
      const timer = (owner.socketTimeoutTimer = setTimeout(expired, 10));
      expect(() =>
        owner.commitHandoff(candidate, { host: "localhost", port: 6380 }),
      ).to.throw("Cannot adopt a transport");
      expect(candidate.detachTransport.called).to.equal(false);
      expect(candidate.dispose.called).to.equal(false);
      expect(owner.socketTimeoutTimer).to.equal(timer);
      clock.tick(10);
      expect(expired.calledOnce).to.equal(true);
    });
  }
});
