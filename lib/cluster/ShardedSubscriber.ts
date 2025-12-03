import EventEmitter = require("events");
import Redis from "../redis";
import { getConnectionName, getNodeKey, IRedisOptions } from "./util";
import { Debug } from "../utils";
const debug = Debug("cluster:subscriberGroup:shardedSubscriber");

export default class ShardedSubscriber {
  private readonly nodeKey: string;
  private started = false;
  private instance: any = null;

  // Store listener references for cleanup
  private readonly messageListeners: Map<string, (...args: any[]) => void> =
    new Map();

  constructor(private readonly emitter: EventEmitter, options: IRedisOptions) {
    this.instance = new Redis({
      port: options.port,
      host: options.host,
      username: options.username,
      password: options.password,
      enableReadyCheck: false,
      connectionName: getConnectionName("ssubscriber", options.connectionName),
      lazyConnect: true,
      tls: options.tls,
      /**
       * Disable auto reconnection for subscribers.
       * The ClusterSubscriberGroup will handle the reconnection.
       */
      retryStrategy: null,
    });

    this.nodeKey = getNodeKey(options);

    // Register listeners
    this.instance.once("end", this.onEnd);
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

  private onEnd = () => {
    this.started = false;
    this.emitter.emit("-node", this.instance, this.nodeKey);
  };

  private onError = (error: Error) => {
    this.emitter.emit("nodeError", error, this.nodeKey);
  };

  private onMoved = () => {
    this.emitter.emit("moved");
  };

  async start(): Promise<void> {
    if (this.started) {
      debug("already started %s", this.nodeKey);
      return;
    }

    try {
      await this.instance.connect();
      debug("started %s", this.nodeKey);
      this.started = true;
    } catch (err) {
      debug("failed to start %s: %s", this.nodeKey, err);
      this.started = false;
      throw err; // Re-throw so caller knows it failed
    }
  }

  stop(): void {
    this.started = false;

    if (this.instance) {
      this.instance.disconnect();
      this.instance.removeAllListeners();
      this.messageListeners.clear();
      this.instance = null;
    }

    debug("stopped %s", this.nodeKey);
  }

  /**
   * Checks if the subscriber is started and NOT explicitly disconnected.
   */
  isStarted(): boolean {
    const status = this.instance?.status;

    const isDisconnected =
      status === "end" || status === "close" || !this.instance;

    return this.started && !isDisconnected;
  }

  getInstance(): any {
    return this.instance;
  }

  getNodeKey(): string {
    return this.nodeKey;
  }
}
