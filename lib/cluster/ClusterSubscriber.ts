import { EventEmitter } from "events";
import ConnectionPool from "./ConnectionPool";
import { getConnectionName, getNodeKey } from "./util";
import { sample, noop, Debug } from "../utils";
import Redis from "../Redis";

const debug = Debug("cluster:subscriber");

export default class ClusterSubscriber {
  private started = false;

  //There is only one connection for the entire pool
  private subscriber: any = null;
  private lastActiveSubscriber: any;

  //The slot range for which this subscriber is responsible
  private slotRange: number[] = []

  constructor(
    private connectionPool: ConnectionPool,
    private emitter: EventEmitter,
    private isSharded : boolean = false
  ) {
    // If the current node we're using as the subscriber disappears
    // from the node pool for some reason, we will select a new one
    // to connect to.
    // Note that this event is only triggered if the connection to
    // the node has been used; cluster subscriptions are setup with
    // lazyConnect = true. It's possible for the subscriber node to
    // disappear without this method being called!
    // See https://github.com/luin/ioredis/pull/1589
    this.connectionPool.on("-node", (_, key: string) => {
      if (!this.started || !this.subscriber) {
        return;
      }
      if (getNodeKey(this.subscriber.options) === key) {
        debug("subscriber has left, selecting a new one...");
        this.selectSubscriber();
      }
    });
    this.connectionPool.on("+node", () => {
      if (!this.started || this.subscriber) {
        return;
      }
      debug(
        "a new node is discovered and there is no subscriber, selecting a new one..."
      );
      this.selectSubscriber();
    });
  }

  getInstance(): any {
    return this.subscriber;
  }

  /**
   * Associate this subscriber to a specific slot range.
   *
   * Returns the range or an empty array if the slot range couldn't be associated.
   *
   * BTW: This is more for debugging and testing purposes.
   *
   * @param range
   */
  associateSlotRange(range: number[]): number[] {
    if (this.isSharded) {
      this.slotRange = range;
    }
    return this.slotRange;
  }

  start(): void {
    this.started = true;
    this.selectSubscriber();
    debug("started");
  }

  stop(): void {
    this.started = false;
    if (this.subscriber) {
      this.subscriber.disconnect();
      this.subscriber = null;
    }
  }

  isStarted(): boolean {
    return this.started;
  }


  private onSubscriberEnd = () => {
    if (!this.started) {
      debug(
        "subscriber has disconnected, but ClusterSubscriber is not started, so not reconnecting."
      );
      return;
    }
    // If the subscriber closes whilst it's still the active connection,
    // we might as well try to connecting to a new node if possible to
    // minimise the number of missed publishes.
    debug("subscriber has disconnected, selecting a new one...");
    this.selectSubscriber();
  };

  private selectSubscriber() {
    const lastActiveSubscriber = this.lastActiveSubscriber;

    // Disconnect the previous subscriber even if there
    // will not be a new one.
    if (lastActiveSubscriber) {
      lastActiveSubscriber.off("end", this.onSubscriberEnd);
      lastActiveSubscriber.disconnect();
    }

    if (this.subscriber) {
      this.subscriber.off("end", this.onSubscriberEnd);
      this.subscriber.disconnect();
    }

    const sampleNode = sample(this.connectionPool.getNodes());
    if (!sampleNode) {
      debug(
        "selecting subscriber failed since there is no node discovered in the cluster yet"
      );
      this.subscriber = null;
      return;
    }

    const { options } = sampleNode;
    debug("selected a subscriber %s:%s", options.host, options.port);

    /*
     * Create a specialized Redis connection for the subscription.
     * Note that auto reconnection is enabled here.
     *
     * `enableReadyCheck` is also enabled because although subscription is allowed
     * while redis is loading data from the disk, we can check if the password
     * provided for the subscriber is correct, and if not, the current subscriber
     * will be disconnected and a new subscriber will be selected.
     */
    let connectionPrefix = "subscriber";
    if (this.isSharded)
      connectionPrefix = "ssubscriber";

    this.subscriber = new Redis({
      port: options.port,
      host: options.host,
      username: options.username,
      password: options.password,
      enableReadyCheck: true,
      connectionName: getConnectionName(connectionPrefix, options.connectionName),
      lazyConnect: true,
      tls: options.tls,
      // Don't try to reconnect the subscriber connection. If the connection fails
      // we will get an end event (handled below), at which point we'll pick a new
      // node from the pool and try to connect to that as the subscriber connection.
      retryStrategy: null,
    });

    // Ignore the errors since they're handled in the connection pool.
    this.subscriber.on("error", noop);

    // The node we lost connection to may not come back up in a
    // reasonable amount of time (e.g. a slave that's taken down
    // for maintainence), we could potentially miss many published
    // messages so we should reconnect as quickly as possible, to
    // a different node if needed.
    this.subscriber.once("end", this.onSubscriberEnd);

    // Re-subscribe previous channels
    const previousChannels = { subscribe: [], psubscribe: [], ssubscribe: [] };
    if (lastActiveSubscriber) {
      const condition =
        lastActiveSubscriber.condition || lastActiveSubscriber.prevCondition;
      if (condition && condition.subscriber) {
        previousChannels.subscribe = condition.subscriber.channels("subscribe");
        previousChannels.psubscribe =
          condition.subscriber.channels("psubscribe");
        previousChannels.ssubscribe =
          condition.subscriber.channels("ssubscribe");
      }
    }
    if (
      previousChannels.subscribe.length ||
      previousChannels.psubscribe.length ||
      previousChannels.ssubscribe.length
    ) {
      let pending = 0;
      for (const type of ["subscribe", "psubscribe", "ssubscribe"]) {
        const channels = previousChannels[type];
        if (channels.length) {
          pending += 1;
          debug("%s %d channels", type, channels.length);
          this.subscriber[type](channels)
            .then(() => {
              if (!--pending) {
                this.lastActiveSubscriber = this.subscriber;
              }
            })
            .catch(() => {
              // TODO: should probably disconnect the subscriber and try again.
              debug("failed to %s %d channels", type, channels.length);
            });
        }
      }
    } else {
      this.lastActiveSubscriber = this.subscriber;
    }
    for (const event of [
      "message",
      "messageBuffer",
    ]) {
      this.subscriber.on(event, (arg1, arg2) => {
        this.emitter.emit(event, arg1, arg2);
      });
    }

    for (const event of ["pmessage", "pmessageBuffer"]) {
      this.subscriber.on(event, (arg1, arg2, arg3) => {
        this.emitter.emit(event, arg1, arg2, arg3);
      });
    }

    if (this.isSharded == true) {
      for (const event of [
        "smessage",
        "smessageBuffer",
      ]) {
        this.subscriber.on(event, (arg1, arg2) => {
          this.emitter.emit(event, arg1, arg2);
        });
      }
    }
  }
}
