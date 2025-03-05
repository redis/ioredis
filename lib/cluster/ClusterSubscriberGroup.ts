import {Debug} from "../utils";
import ClusterSubscriber from "./ClusterSubscriber";
import Cluster from "./index";
import ConnectionPool from "./ConnectionPool";
import {getNodeKey} from "./util";
import * as calculateSlot from "cluster-key-slot";
const debug = Debug("cluster:subscriberGroup");


/**
 * Redis differs between "normal" and sharded PubSub. If using the "normal" PubSub feature, exactly one
 * ClusterSubscriber exists per cluster instance. This works because the Redis cluster bus forwards m
 * messages between shards. However, this has scalability limitations, which is the reason why the sharded
 * PubSub feature was added to Redis. With sharded PubSub, each shard is responsible for its own messages.
 * Given that, we need at least one ClusterSubscriber per master endpoint/node.
 *
 * This class leverages the previously exising ClusterSubscriber by adding support for multiple such subscribers
 * in alignment to the master nodes of the cluster. The ClusterSubscriber class was extended in a non-breaking way
 * to support this feature.
 */
export default class ClusterSubscriberGroup {

    private shardedSubscribers: Map<string, ClusterSubscriber> = new Map();
    private clusterSlots: string[][] = [];
    //Simple [min, max] slot ranges aren't enough because you can migrate single slots
    private subscriberToSlotsIndex: Map<string, number[]> = new Map();
    private channels: Map<number, Array<(string | Buffer)>> = new Map();

    /**
     * Register callbacks
     *
     * @param cluster
     */
    constructor(private cluster: Cluster) {

        cluster.on("+node", (redis) => {
            this._addSubscriber(redis);
        });

        cluster.on("-node", (redis) => {
            this._removeSubscriber(redis);
        });

        cluster.on("refresh", () => {
            this._refreshSlots(cluster);
        });
    }


    /**
     * Get the responsible subscriber.
     *
     * Returns null if no subscriber was found
     *
     * @param slot
     */
    getResponsibleSubscriber(slot: number) : ClusterSubscriber {
        const nodeKey = this.clusterSlots[slot][0]
        return this.shardedSubscribers.get(nodeKey);
    }

    /**
     * Adds a channel for which this subscriber group is responsible
     *
     * @param channels
     */
    addChannels(channels: (string | Buffer)[]): number {
        const slot = calculateSlot(channels[0]);

        //Check if the all channels belong to the same slot and otherwise reject the operation
        channels.forEach((c: string) => {
            if (calculateSlot(c) != slot)
                return -1
        });

        const currChannels = this.channels.get(slot);

        if (!currChannels) {
            this.channels.set(slot, channels);
        } else {
            this.channels.set(slot, currChannels.concat(channels))
        }

        return [...this.channels.values()].flatMap(v => v).length;
    }

    /**
     * Removes channels for which the subscriber group is responsible by optionally unsubscribing
     * @param channels
     */
    removeChannels(channels: (string | Buffer)[]): number {

        const slot = calculateSlot(channels[0]);

        //Check if the all channels belong to the same slot and otherwise reject the operation
        channels.forEach((c: string) => {
            if (calculateSlot(c) != slot)
                return -1;
        });

        const slotChannels = this.channels.get(slot);

        if (slotChannels) {
            const updatedChannels = slotChannels.filter(c => !channels.includes(c));
            this.channels.set(slot, updatedChannels);
        }

        return [...this.channels.values()].flatMap(v => v).length;
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
        for (const s of this.shardedSubscribers.values()) {
            if (!s.isStarted()) {
                s.start();
            }
        }
    }

    /**
     * Add a subscriber to the group of subscribers
     *
     * @param redis
     */
    private _addSubscriber(redis: any): ClusterSubscriber {
        const pool: ConnectionPool= new ConnectionPool(redis.options);

        if (pool.addMasterNode(redis)) {
            const sub = new ClusterSubscriber(pool, this.cluster, true);
            const nodeKey = getNodeKey(redis.options);
            this.shardedSubscribers.set(nodeKey, sub);
            sub.start();

            // We need to attempt to resubscribe them in case the new node serves their slot
            this._resubscribe();
            this.cluster.emit("+subscriber");
            return sub;
        }

        return null;
    }

    /**
     * Removes a subscriber from the group
     * @param redis
     */
    private _removeSubscriber(redis: any): Map<string, ClusterSubscriber> {

        const nodeKey = getNodeKey(redis.options);
        const sub = this.shardedSubscribers.get(nodeKey);

        if (sub) {
            sub.stop();
            this.shardedSubscribers.delete(nodeKey);

            // Even though the subscriber to this node is going down, we might have another subscriber
            // handling the same slots, so we need to attempt to subscribe the orphaned channels
            this._resubscribe();
            this.cluster.emit("-subscriber");
        }

        return this.shardedSubscribers;
    }


    /**
     * Refreshes the subscriber-related slot ranges
     *
     * Returns false if no refresh was needed
     *
     * @param cluster
     */
    private _refreshSlots(cluster: Cluster) : boolean {
        //If there was an actual change, then reassign the slot ranges
        if (this._slotsAreEqual(cluster.slots)) {
            debug("Nothing to refresh because the new cluster map is equal to the previous one.")
        } else {
            debug("Refreshing the slots of the subscriber group.");

            //Rebuild the slots index
            this.subscriberToSlotsIndex = new Map();

            for (let slot = 0; slot < cluster.slots.length; slot++) {
                const node: string = cluster.slots[slot][0];

                if (!this.subscriberToSlotsIndex.has(node)) {
                    this.subscriberToSlotsIndex.set(node, []);
                }
                this.subscriberToSlotsIndex.get(node).push(Number(slot))
            }

            //Update the subscribers from the index
            this._resubscribe()

            //Update the cached slots map
            this.clusterSlots = JSON.parse(JSON.stringify(cluster.slots));

            this.cluster.emit("subscribersReady")
            return true;
        }

        return false;
    }


    /**
     * Resubscribes to the previous channels
     *
     * @private
     */
    private _resubscribe() {
        if (this.shardedSubscribers) {
            this.shardedSubscribers.forEach((s: ClusterSubscriber, nodeKey: string) => {
                const subscriberSlots = this.subscriberToSlotsIndex.get(nodeKey);
                if (subscriberSlots) {
                    //More for debugging purposes
                    s.associateSlotRange(subscriberSlots);

                    //Resubscribe on the underlying connection
                    subscriberSlots.forEach((ss) => {

                        //Might return null if being disconnected
                        const redis = s.getInstance();
                        const channels = this.channels.get(ss);

                        if (channels && channels.length > 0) {
                            //Try to subscribe now
                            if (redis) {
                                redis.ssubscribe(channels);

                                //If the instance isn't ready yet, then register the re-subscription for later
                                redis.on("ready", () => {
                                    redis.ssubscribe(channels);
                                });
                            }
                        }
                    });
                }
            });
        }
    }

    /**
     * Deep equality of the cluster slots objects
     *
     * @param other
     * @private
     */
    private _slotsAreEqual(other: string[][]) {
        if ( this.clusterSlots === undefined )
            return false;
        else
            return JSON.stringify(this.clusterSlots) === JSON.stringify(other)
    }


}