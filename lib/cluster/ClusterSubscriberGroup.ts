import { Debug } from "../utils";
import { getNodeKey } from "./util";
import * as calculateSlot from "cluster-key-slot";
import ShardedSubscriber from "./ShardedSubscriber";
import * as EventEmitter from "events";
const debug = Debug("cluster:subscriberGroup");

/**
 * Redis distinguishes between "normal" and sharded PubSub. When using the normal PubSub feature,
 * exactly one subscriber exists per cluster instance because the Redis cluster bus forwards
 * messages between shards. Sharded PubSub removes this limitation by making each shard
 * responsible for its own messages.
 *
 * This class coordinates one ShardedSubscriber per master node in the cluster, providing
 * sharded PubSub support while keeping the public API backward compatible.
 */
export default class ClusterSubscriberGroup {
  private shardedSubscribers: Map<string, ShardedSubscriber> = new Map();
  private clusterSlots: string[][] = [];
  // Simple [min, max] slot ranges aren't enough because you can migrate single slots
  private subscriberToSlotsIndex: Map<string, number[]> = new Map();
  private channels: Map<number, Array<string | Buffer>> = new Map();

  /**
   * Register callbacks
   *
   * @param cluster
   */
  constructor(private readonly subscriberGroupEmitter: EventEmitter) {}

  /**
   * Get the responsible subscriber.
   *
   * @param slot
   */
  getResponsibleSubscriber(slot: number): ShardedSubscriber | undefined {
    const nodeKey = this.clusterSlots[slot][0];
    return this.shardedSubscribers.get(nodeKey);
  }

  /**
   * Adds a channel for which this subscriber group is responsible
   *
   * @param channels
   */
  addChannels(channels: (string | Buffer)[]): number {
    const slot = calculateSlot(channels[0]);

    // Check if the all channels belong to the same slot and otherwise reject the operation
    for (const c of channels) {
      if (calculateSlot(c) !== slot) {
        return -1;
      }
    }

    const currChannels = this.channels.get(slot);

    if (!currChannels) {
      this.channels.set(slot, channels);
    } else {
      this.channels.set(slot, currChannels.concat(channels));
    }

    return Array.from(this.channels.values()).reduce(
      (sum, array) => sum + array.length,
      0
    );
  }

  /**
   * Removes channels for which the subscriber group is responsible by optionally unsubscribing
   * @param channels
   */
  removeChannels(channels: (string | Buffer)[]): number {
    const slot = calculateSlot(channels[0]);

    // Check if the all channels belong to the same slot and otherwise reject the operation
    for (const c of channels) {
      if (calculateSlot(c) !== slot) {
        return -1;
      }
    }

    const slotChannels = this.channels.get(slot);

    if (slotChannels) {
      const updatedChannels = slotChannels.filter((c) => !channels.includes(c));
      this.channels.set(slot, updatedChannels);
    }

    return Array.from(this.channels.values()).reduce(
      (sum, array) => sum + array.length,
      0
    );
  }

  /**
   * Disconnect all subscribers
   */
  stop() {
    for (const s of this.shardedSubscribers.values()) {
      s.stop();
    }
  }

  /**
   * Start all not yet started subscribers
   */
  start() {
    const startPromises = [];
    for (const s of this.shardedSubscribers.values()) {
      if (!s.isStarted()) {
        startPromises.push(
          s.start().catch((err) => {
            this.subscriberGroupEmitter.emit("subscriberConnectFailed", err);
          })
        );
      }
    }
    return Promise.all(startPromises);
  }

  /**
   * Resets the subscriber group by disconnecting all subscribers that are no longer needed and connecting new ones.
   */
  public async reset(
    clusterSlots: string[][],
    clusterNodes: any[]
  ): Promise<void> {
    const hasTopologyChanged = this._refreshSlots(clusterSlots);
    const hasFailedSubscribers = this.hasUnhealthySubscribers();

    if (!hasTopologyChanged && !hasFailedSubscribers) {
      debug(
        "No topology change detected or failed subscribers. Skipping reset."
      );
      return;
    }

    // For each of the sharded subscribers
    for (const [nodeKey, shardedSubscriber] of this.shardedSubscribers) {
      if (
        // If the subscriber is still responsible for a slot range and is running then keep it
        this.subscriberToSlotsIndex.has(nodeKey) &&
        shardedSubscriber.isStarted()
      ) {
        debug("Skipping deleting subscriber for %s", nodeKey);
        continue;
      }

      debug("Removing subscriber for %s", nodeKey);
      // Otherwise stop the subscriber and remove it
      shardedSubscriber.stop();
      this.shardedSubscribers.delete(nodeKey);

      this.subscriberGroupEmitter.emit("-subscriber");
    }

    const startPromises = [];
    // For each node in slots cache
    for (const [nodeKey, _] of this.subscriberToSlotsIndex) {
      // If we already have a subscriber for this node then keep it
      if (this.shardedSubscribers.has(nodeKey)) {
        debug("Skipping creating new subscriber for %s", nodeKey);
        continue;
      }

      debug("Creating new subscriber for %s", nodeKey);
      // Otherwise create a new subscriber
      const redis = clusterNodes.find((node) => {
        return getNodeKey(node.options) === nodeKey;
      });

      if (!redis) {
        debug("Failed to find node for key %s", nodeKey);
        continue;
      }

      const sub = new ShardedSubscriber(
        this.subscriberGroupEmitter,
        redis.options
      );

      this.shardedSubscribers.set(nodeKey, sub);

      startPromises.push(
        sub.start().catch((err) => {
          this.subscriberGroupEmitter.emit("subscriberConnectFailed", err);
        })
      );

      this.subscriberGroupEmitter.emit("+subscriber");
    }

    // It's vital to await the start promises before resubscribing
    // Otherwise we might try to resubscribe to a subscriber that is not yet connected
    // This can cause a race condition
    try {
      await Promise.all(startPromises);
    } catch (err) {
      debug("Error while starting subscribers: %s", err);
      this.subscriberGroupEmitter.emit("error", err);
    }

    this._resubscribe();
    this.subscriberGroupEmitter.emit("subscribersReady");
  }

  /**
   * Refreshes the subscriber-related slot ranges
   *
   * Returns false if no refresh was needed
   *
   * @param targetSlots
   */
  private _refreshSlots(targetSlots: string[][]): boolean {
    //If there was an actual change, then reassign the slot ranges
    if (this._slotsAreEqual(targetSlots)) {
      debug(
        "Nothing to refresh because the new cluster map is equal to the previous one."
      );

      return false;
    }

    debug("Refreshing the slots of the subscriber group.");

    //Rebuild the slots index
    this.subscriberToSlotsIndex = new Map();

    for (let slot = 0; slot < targetSlots.length; slot++) {
      const node: string = targetSlots[slot][0];

      if (!this.subscriberToSlotsIndex.has(node)) {
        this.subscriberToSlotsIndex.set(node, []);
      }
      this.subscriberToSlotsIndex.get(node).push(Number(slot));
    }

    //Update the cached slots map
    this.clusterSlots = JSON.parse(JSON.stringify(targetSlots));

    return true;
  }

  /**
   * Resubscribes to the previous channels
   *
   * @private
   */
  private _resubscribe() {
    if (this.shardedSubscribers) {
      this.shardedSubscribers.forEach(
        (s: ShardedSubscriber, nodeKey: string) => {
          const subscriberSlots = this.subscriberToSlotsIndex.get(nodeKey);
          if (subscriberSlots) {
            //Resubscribe on the underlying connection
            subscriberSlots.forEach((ss) => {
              //Might return null if being disconnected
              const redis = s.getInstance();
              const channels = this.channels.get(ss);

              if (channels && channels.length > 0) {
                //Try to subscribe now
                if (redis && redis.status !== "end") {
                  redis.ssubscribe(channels).catch((err) => {
                    // TODO: Should we emit an error event here?
                    debug("Failed to ssubscribe on node %s: %s", nodeKey, err);
                  });
                }
              }
            });
          }
        }
      );
    }
  }

  /**
   * Deep equality of the cluster slots objects
   *
   * @param other
   * @private
   */
  private _slotsAreEqual(other: string[][]) {
    if (this.clusterSlots === undefined) {
      return false;
    } else {
      return JSON.stringify(this.clusterSlots) === JSON.stringify(other);
    }
  }

  /**
   * Checks if any subscribers are in an unhealthy state.
   *
   * A subscriber is considered unhealthy if:
   * - It exists but is not started (failed/disconnected)
   * - It's missing entirely for a node that should have one
   *
   * @returns true if any subscribers need to be recreated
   */
  private hasUnhealthySubscribers(): boolean {
    const hasFailedSubscribers = Array.from(
      this.shardedSubscribers.values()
    ).some((sub) => !sub.isStarted());

    const hasMissingSubscribers = Array.from(
      this.subscriberToSlotsIndex.keys()
    ).some((nodeKey) => !this.shardedSubscribers.has(nodeKey));

    return hasFailedSubscribers || hasMissingSubscribers;
  }
}
