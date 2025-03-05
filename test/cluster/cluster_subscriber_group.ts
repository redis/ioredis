import {expect} from "chai";
import Redis, {Cluster} from "../../lib";
import redis from "../../lib";

const host = "127.0.0.1";
const masters = [30000, 30001, 30002];
const port: number = masters[0]

/**
 * Wait for a specified time
 *
 * @param ms
 */
function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


describe("cluster:ClusterSubscriberGroup", () => {

    it("should unsubscribe from the given channel", async () => {

        const cluster: Cluster = new Cluster([{host: host, port: port}], {shardedSubscribers: true});

        //Subscribe to the three channels
        cluster.ssubscribe("channel:1:{1}", "channel:2:{1}", "channel:3:{1}" ).then( ( count: number ) => {
            console.log("Subscribed to 3 channels.");
            expect(count).to.equal(3);
        });

        //Publish a message to one of the channels
        cluster.spublish("channel:2:{1}", "This is a test message to channel 2.").then((value: number) => {
            console.log("Published a message to channel:2:{1} and expect one subscriber.");
            expect(value).to.be.eql(1);
        });

        await sleep(500);

        //Unsubscribe from one of the channels
        cluster.sunsubscribe("channel:2:{1}").then( ( count: number ) => {
            console.log("Unsubscribed from channel:2:{1}.");
            expect(count).to.equal(2);
        });

        await sleep(500);

        //Publish a message to the channel from which we unsubscribed
        cluster.spublish("channel:2:{1}", "This is a test message to channel 2.").then((value: number) => {
            console.log("Published a second message to channel:2:{1} and expect to have nobody listening.");
            expect(value).to.be.eql(0);
        });

        await sleep(1000);
        await cluster.disconnect();
    });

    it("works when ssubscribe only works for keys that map to the same slot", async () => {

        const cluster: Cluster = new Cluster([{host: host, port: port}], {shardedSubscribers: true});

        //Register the callback
        cluster.on("smessage", (channel, message) => {
            console.log(message);
            expect(message.startsWith("This is a test message")).to.be.true;
        });

        //Subscribe to the channels on different slots
        cluster.ssubscribe("channel{my}:1", "channel{yours}:2").then( ( count: number ) => {
            //Should not be called
            expect(true).to.equal(false);
        }).catch( (err) => {
            expect(err.toString().conaints("CROSSSLOT Keys in request don't hash to the same slot")).to.be.true;
        });

        //Subscribe to the channels on the same slot
        cluster.ssubscribe("channel{my}:1", "channel{my}:2").then( ( count: number ) => {
            console.log(count);
            expect(count).to.equal(2);
        }).catch( (err) => {
            expect(true).to.equal(false);
        });

        //Subscribe once again on the other slot
        cluster.ssubscribe("channel{yours}:2").then( ( count: number ) => {
            console.log(count);
            expect(count).to.equal(1);
        }).catch( (err) => {
            expect(true).to.equal(false);
        });

        //Publish messages
        cluster.spublish("channel{my}:1", "This is a test message to my first channel.").then((value: number) => {
            console.log("Published a message to channel{my}:1");
            expect(value).to.be.eql(1);
        });

        cluster.spublish("channel{my}:2", "This is a test message to my second channel.").then((value: number) => {
            console.log("Published a message to channel{my}:2");
            expect(value).to.be.eql(1);
        });

        cluster.spublish("channel{yours}:2", "This is a test message to your second channel.").then((value: number) => {
            console.log("Published a message to channel{yours}:2");
            expect(value).to.be.eql(1);
        });

        //Give it some time to process messages and then disconnect
        await sleep(1000);
        await cluster.disconnect();
    });


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
            expect(message.startsWith("This is a test message")).to.eql(true);
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
            const numSubscribers = await publisher.spublish(c, "This is a test message  " + c + ".");
            expect(numSubscribers).to.eql(1);
        }

        //Give it some time to process messages and then disconnect
        await sleep(1000);
        subscriber.disconnect();
    });

    it("receive messages on the channel after the slot was moved", async () => {

        //The hash slot of interest
        const slot = 2318;
        const channel = "channel:test:3";

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
                expect(message.includes("#1")).to.eql(true);
            }

            if (totalNumMessages == 2) {
                console.log("Received the second message");
                expect(message.includes("#2")).to.eql(true);
            }
        });

        //Subscribe and then publish
        await subscriber.ssubscribe(channel);
        await publisher.spublish(channel, "This is a test message #1 to slot "
            + slot + " on channel " + channel + ".");

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
        status = await subscriber.set("match_slot{" + channel + "}", "channel 3");
        expect(status).to.eql("OK");
        expect(subscriber.slots[slot][0]).eql("127.0.0.1:30001");

        //Wait a bit to let the subscriber resubscribe to previous channels
        await sleep(1000);

        const numSubscribers = await publisher.spublish(channel, "This is a test message #2 to slot "
            + slot + " on channel " + channel + ".");
        expect(publisher.slots[slot][0]).eql("127.0.0.1:30001");
        expect(numSubscribers).to.eql(1);
    });
});