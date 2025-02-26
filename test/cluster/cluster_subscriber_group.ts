import {expect} from "chai";
import Redis, {Cluster} from "../../lib";

const host = "127.0.0.1";
const masters = [30000, 30001, 30002];
const port: number = masters[0]

describe("cluster:ClusterSubscriberGroup", () => {
    it("works when you can receive published messages to all primary nodes after having subscribed", async () => {

        // 0. Prepare the publisher and the subscriber
        const publisher: Cluster = new Cluster([{host: host, port: port}]);

        //-- Publisher
        // Verify that the cluster is configured with 3 master nodes
        publisher.on("ready", () => {
            expect(publisher.nodes("master").length).to.eql(3);
        });

        //-- Subscriber
        const subscriber: Cluster = new Cluster([{host: host, port: port}], {shardedSubscribers: true});
        let totalNumMessages = 0;

        // Register the subscriber callback
        subscriber.on("smessage", (channel, message) => {
            console.log(message);
            expect(message.startsWith("This is a test message to")).to.eql(true);
            expect(message.endsWith(channel + ".")).to.eql(true);
            totalNumMessages++;
            expect(totalNumMessages).to.lte(3);
        });

        //Verify that we did not get more than 3 subscribers
        let numSubs = 0;
        subscriber.on("+subscriber", () => {
            numSubs++
            expect(numSubs).to.lte(3);
        });

        //1. Construct 3 channel names, whereby the first one is expected to land on node 1, the second one on node 2, and so on
        const channels = ["channel:test:3", "channel:test:2", "channel:test:0"]

        for (const c of channels) {
            console.log("Trying to publish to channel:", c);

            //2. Subscribe to the channel
            await subscriber.ssubscribe(c)

            //3. Publish a message before initializing the message handling
            const numSubscribers = await publisher.spublish(c, "This is a test message to " + c + ".");
            expect(numSubscribers).to.eql(1);
        }
    });

    it("receive messages on the channel after the slot was moved", async () => {

        //The hash slot of interest
        const slot = 2318;

        //Used as control connections for orchestrating the slot migration
        const source: Redis = new Redis({host: host, port: 30000});
        const target: Redis = new Redis({host: host, port: 30001});

        //Initialize the publisher cluster connections and verify that the slot is on node 1
        const publisher: Cluster = new Cluster([{host: host, port: port}]);

        publisher.on("ready", () => {
            expect(publisher.slots[slot][0]).eql("127.0.0.1:30000");
        });


        //Initialize the subscriber cluster connections and verify that the slot is on node 1
        const subscriber: Cluster = new Cluster([{host: host, port: port}], {shardedSubscribers: true});

        subscriber.on("ready",  () => {
            expect(subscriber.slots[slot][0]).eql("127.0.0.1:30000")
        });

        //The subscription callback. We should receive both messages
        let totalNumMessages = 0;
        subscriber.on("smessage", (channel, message) => {
            totalNumMessages++;

            if (totalNumMessages == 1) {
                console.log("Received the first message");
            }

            if (totalNumMessages == 2) {
                console.log("Received the second message");
            }
        });

        //Subscribe and then publish
        await subscriber.ssubscribe("channel:test:3");
        await publisher.spublish("channel:test:3", "This is a test message to slot " + slot + ".");

        //Get the target node
        const nodes = await source.cluster('SLOTS');
        const sourceNode = nodes[0][2][2];
        const targetNode = nodes[1][2][2];

        //Migrate the slot
        console.log(`Migrating slot ${slot} to ${targetNode}`);
        let status = ""
        status = await target.cluster("SETSLOT", slot, "IMPORTING", targetNode);
        expect(status).to.eql("OK");
        status = await source.cluster('SETSLOT', slot, 'MIGRATING', sourceNode);
        expect(status).to.eql("OK");
        status = await target.cluster("SETSLOT", slot, "NODE", targetNode);
        expect(status).to.eql("OK");
        status = await source.cluster("SETSLOT", slot, "NODE", targetNode);
        expect(status).to.eql("OK");

        //Trigger a topology update on the subscriber. This needs at least one moved response.
        //TODO: What if there is no traffic on the cluster connection?
        status = await subscriber.set("match_slot{channel:test:3}", "channel 3");
        expect(status).to.eql("OK");
        expect(subscriber.slots[slot][0]).eql("127.0.0.1:30001");

        const numSubscribers = await publisher.spublish("channel:test:3", "This is a test message to slot {slot}.");
        expect(publisher.slots[slot][0]).eql("127.0.0.1:30001");
        expect(numSubscribers).to.eql(1);
    });
});