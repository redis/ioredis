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
    private orphanedChannels: Map<number, Array<string>> = new Map();

    /**
     * Register callbacks
     *
     * @param cluster
     */
    constructor(private cluster: Cluster) {

        cluster.on("+node", (redis) => {
            this.addSubscriber(redis);
        });

        cluster.on("-node", (redis) => {
            this.removeSubscriber(redis);
        });

        cluster.on("refresh", () => {
            this.refreshSlots(cluster);
        });
    }


    /**
     * Add a subscriber to the group of subscribers
     *
     * @param redis
     */
    addSubscriber(redis: any): ClusterSubscriber {
        const pool: ConnectionPool= new ConnectionPool(redis.options);

        if (pool.addMasterNode(redis)) {
            const sub = new ClusterSubscriber(pool, this.cluster, true);
            const nodeKey = getNodeKey(redis.options);
            this.shardedSubscribers.set(nodeKey, sub);
            sub.start();
            this.cluster.emit("+subscriber");
            this.attemptToSubscribe();
            return sub;
        }

        return null;
    }

    /**
     * Removes a subscriber from the group
     * @param options
     */
    removeSubscriber(redis: any): Map<string, ClusterSubscriber> {

        const nodeKey = getNodeKey(redis.options);
        const sub = this.shardedSubscribers.get(nodeKey);

        if (sub) {
            this.updateOrphaned(sub.getLastInstance());
            sub.stop();
            this.shardedSubscribers.delete(nodeKey);
            this.cluster.emit("-subscriber");
        }

        return this.shardedSubscribers;
    }

    // Save the list of channels that were orphaned by the subscriber
    private updateOrphaned(lastActiveSubscriber: any) {
        if (lastActiveSubscriber) {
            const condition = lastActiveSubscriber.condition || lastActiveSubscriber.prevCondition;
            if (condition && condition.subscriber && condition.subscriber.channels("ssubscribe")) {
                condition.subscriber.channels("ssubscribe").forEach((channel: string) => {
                    const slot: number = calculateSlot(channel);
                    const slotChannels = this.orphanedChannels.get(slot);
                    if (slotChannels){
                        slotChannels.push(channel);
                    } else {
                        this.orphanedChannels.set(slot, [channel]);
                    }
                });
            }
        }
    }

    private attemptToSubscribe() {
        for(const slot of Array.from( this.orphanedChannels.keys())){
            const subscriber = this.getResponsibleSubscriber(slot);
            if(subscriber){
                const instance = subscriber.getInstance();
                const channels = this.orphanedChannels.get(slot);
                instance.ssubscribe(channels);
                this.orphanedChannels.delete(slot);
            }
        }
    }

    /**
     * Get the responsible subscriber.
     *
     * Returns null if no subscriber was found
     *
     * @param slot
     */
    getResponsibleSubscriber(slot: number ) : ClusterSubscriber {
        const nodeKey = this.clusterSlots[slot][0]
        return this.shardedSubscribers.get(nodeKey);
     }

    /**
     * Refreshes the subscriber-related slot ranges
     *
     * Returns false if no refresh was needed
     *
     * @param cluster
     */
    refreshSlots(cluster: Cluster) : boolean {
        //If there was an actual change, then reassign the slot ranges
        //TODO: Do I compare the same object here? Better compare the JSON.stringify(...) results
        //TODO: Test what happens if we move a slot
        if (this.clusterSlots !== cluster.slots) {

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
            this.shardedSubscribers.forEach((s: ClusterSubscriber, nodeKey: string) => {
                s.associateSlotRange(this.subscriberToSlotsIndex.get(nodeKey));
            })

            this.clusterSlots = cluster.slots;
            this.cluster.emit("subscribersReady")
            return true;
        }

        return false;
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

}