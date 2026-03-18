import EventEmitter = require("events");
import { getConnectionName, getNodeKey, RedisOptions } from "./util";
import { Debug, defaults } from "../utils";
import Redis from "../Redis";
import { ClusterOptions } from "./ClusterOptions";
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

export default class ShardedSubscriber {
  private readonly nodeKey: string;
  private status: SubscriberStatus = SubscriberStatus.IDLE;
  private instance: Redis | null = null;
  private connectPromise: Promise<void> | null = null;
  private lazyConnect: boolean;

  // Store listener references for cleanup
  private readonly messageListeners: Map<string, (...args: any[]) => void> =
    new Map();

  constructor(
    private readonly emitter: EventEmitter,
    options: RedisOptions,
    redisOptions?: ClusterOptions["redisOptions"],
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
          lazyConnect: true,
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
    this.connectPromise = this.instance.connect();

    try {
      await this.connectPromise;
      this.updateStatus(SubscriberStatus.CONNECTED);
    } catch (err) {
      this.updateStatus(SubscriberStatus.ENDED);
      throw err;
    } finally {
      this.connectPromise = null;
    }
  }

  stop(): void {
    this.updateStatus(SubscriberStatus.STOPPING);

    if (this.instance) {
      this.instance.disconnect();
      this.instance.removeAllListeners();
      this.messageListeners.clear();
      this.instance = null;
    }

    this.updateStatus(SubscriberStatus.ENDED);
    debug("stopped %s", this.nodeKey);
  }

  isConnected(): boolean {
    return this.status === SubscriberStatus.CONNECTED;
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
