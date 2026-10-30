import EventEmitter = require("events");
import { getConnectionName, getNodeKey, RedisOptions } from "./util";
import { Debug, defaults } from "../utils";
import Redis from "../Redis";
import { ClusterOptions } from "./ClusterOptions";
import { CommandItem } from "../types";
const debug = Debug("cluster:subscriberGroup:shardedSubscriber");

const SubscriberStatus = {
  IDLE: "idle",
  STARTING: "starting",
  CONNECTED: "connected",
  STOPPING: "stopping",
  ENDED: "ended",
} as const;

type SubscriberStatus = typeof SubscriberStatus[keyof typeof SubscriberStatus];

const ALLOWED_STATUS_UPDATES: Record<SubscriberStatus, SubscriberStatus[]> = {
  [SubscriberStatus.IDLE]: [
    SubscriberStatus.STARTING,
    SubscriberStatus.STOPPING,
    SubscriberStatus.ENDED,
  ],
  [SubscriberStatus.STARTING]: [
    SubscriberStatus.CONNECTED,
    SubscriberStatus.STOPPING,
    SubscriberStatus.ENDED,
  ],
  [SubscriberStatus.CONNECTED]: [
    SubscriberStatus.STOPPING,
    SubscriberStatus.ENDED,
  ],
  [SubscriberStatus.STOPPING]: [SubscriberStatus.ENDED],
  [SubscriberStatus.ENDED]: [],
};

class HealthCheck {
  private timer: NodeJS.Timeout | undefined;
  // Head of commandQueue seen at the previous fire. Same object at the next
  // fire means that command waited a full interval with no reply.
  private suspect: CommandItem | undefined;

  constructor(
    private readonly instance: Redis,
    private readonly intervalMs: number,
    private readonly nodeKey: string,
  ) {
    instance.on("connect", this.arm);
    instance.on("ready", this.touch);
    instance.on("smessageBuffer", this.onMessage);
  }

  stop = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.suspect = undefined;
  };

  private arm = () => {
    this.stop();
    this.timer = setTimeout(this.onFire, this.intervalMs);
  };

  private touch = () => {
    this.timer?.refresh();
  };

  // A stuck proxy still delivers smessage, so a message proves liveness only
  // while nothing waits for a reply.
  private onMessage = () => {
    if (this.instance.commandQueue.length === 0) {
      this.touch();
    }
  };

  private onFire = () => {
    const head = this.instance.commandQueue.peekFront();
    if (head !== undefined && head === this.suspect) {
      this.stop();
      debug(
        "%s left %s unanswered, disconnecting",
        this.nodeKey,
        head.command.name,
      );
      this.instance.disconnect();
      return;
    }

    if (head === undefined && this.instance.status === "ready") {
      this.instance.ping().catch(() => {});
    }

    this.suspect = this.instance.commandQueue.peekFront();
    this.timer?.refresh();
  };
}

export default class ShardedSubscriber {
  private readonly nodeKey: string;
  private status: SubscriberStatus = SubscriberStatus.IDLE;
  private instance: Redis | null = null;
  private connectPromise: Promise<void> | null = null;
  private lazyConnect: boolean;
  private finishStart: (() => void) | null = null;
  private readonly healthCheck: HealthCheck | null;

  // Store listener references for cleanup
  private readonly messageListeners: Map<string, (...args: any[]) => void> =
    new Map();

  constructor(
    private readonly emitter: EventEmitter,
    options: RedisOptions,
    redisOptions?: ClusterOptions["redisOptions"],
    healthCheckInterval?: number,
  ) {
    this.instance = new Redis(
      defaults(
        {
          enableReadyCheck: false,
          enableOfflineQueue: true,
          connectionName: getConnectionName(
            "ssubscriber",
            options.connectionName,
          ),
          /**
           * Disable auto reconnection for subscribers.
           * The ClusterSubscriberGroup will handle the reconnection.
           */
          retryStrategy: null,
          enableAutoPipelining: false,
          lazyConnect: true,
          // Maintenance notifications are currently only supported on
          // standalone clients.
          maintNotifications: "disabled" as const,
        },
        options,
        redisOptions,
      ),
    );

    this.lazyConnect = redisOptions?.lazyConnect ?? true;

    this.nodeKey = getNodeKey(options);

    // Register listeners
    this.instance.on("end", this.onEnd);
    this.instance.on("error", this.onError);
    this.instance.on("moved", this.onMoved);

    for (const event of ["smessage", "smessageBuffer"]) {
      const listener = (...args: any[]) => {
        this.emitter.emit(event, ...args);
      };
      this.messageListeners.set(event, listener);
      this.instance.on(event, listener);
    }

    this.healthCheck = healthCheckInterval
      ? new HealthCheck(this.instance, healthCheckInterval, this.nodeKey)
      : null;
  }

  async start(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (
      this.status === SubscriberStatus.STARTING ||
      this.status === SubscriberStatus.CONNECTED
    ) {
      return;
    }

    if (this.status === SubscriberStatus.ENDED || !this.instance) {
      throw new Error(
        `Sharded subscriber ${this.nodeKey} cannot be restarted once ended.`,
      );
    }

    this.updateStatus(SubscriberStatus.STARTING);
    // stop() removes the instance's listeners, so connect() would never
    // settle. Finish the start instead, so a reset waiting on it can finish.
    const stopped = new Promise<void>((resolve) => {
      this.finishStart = resolve;
    });
    this.connectPromise = Promise.race([this.instance.connect(), stopped]);

    try {
      await this.connectPromise;
      this.updateStatus(SubscriberStatus.CONNECTED);
    } catch (err) {
      this.updateStatus(SubscriberStatus.ENDED);
      throw err;
    } finally {
      this.finishStart = null;
      this.connectPromise = null;
    }
  }

  stop(): void {
    this.healthCheck?.stop();
    this.updateStatus(SubscriberStatus.STOPPING);

    if (this.finishStart) {
      this.finishStart();
    }

    if (this.instance) {
      this.instance.disconnect();
      this.instance.removeAllListeners();
      this.messageListeners.clear();
      this.instance = null;
    }

    this.updateStatus(SubscriberStatus.ENDED);
    debug("stopped %s", this.nodeKey);
  }

  isStarted(): boolean {
    return (
      [
        SubscriberStatus.CONNECTED,
        SubscriberStatus.STARTING,
      ] as SubscriberStatus[]
    ).includes(this.status);
  }

  get subscriberStatus(): SubscriberStatus {
    return this.status;
  }

  isHealthy(): boolean {
    return (
      (this.status === SubscriberStatus.IDLE ||
        this.status === SubscriberStatus.CONNECTED ||
        this.status === SubscriberStatus.STARTING) &&
      this.instance !== null
    );
  }

  getInstance(): Redis | null {
    return this.instance;
  }

  getNodeKey(): string {
    return this.nodeKey;
  }

  isLazyConnect(): boolean {
    return this.lazyConnect;
  }

  private onEnd = () => {
    this.healthCheck?.stop();
    this.updateStatus(SubscriberStatus.ENDED);
    this.emitter.emit("-node", this.instance, this.nodeKey);
  };

  private onError = (error: Error) => {
    this.emitter.emit("nodeError", error, this.nodeKey);
  };

  private onMoved = () => {
    this.emitter.emit("moved");
  };

  private updateStatus(nextStatus: SubscriberStatus): void {
    if (this.status === nextStatus) {
      return;
    }

    if (!ALLOWED_STATUS_UPDATES[this.status].includes(nextStatus)) {
      debug(
        "Invalid status transition for %s: %s -> %s",
        this.nodeKey,
        this.status,
        nextStatus,
      );

      return;
    }

    this.status = nextStatus;
  }
}
