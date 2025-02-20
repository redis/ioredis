import {expect} from "chai";
import {Cluster} from "../../../lib";

const masters = [30000, 30001, 30002];


/*
async function cleanup() {
    for (const port of masters) {
        const redis = new Redis(port);
        await redis.flushall();
        await redis.script("FLUSH");
    }
    // Wait for replication
    await new Promise((resolve) => setTimeout(resolve, 500));
}
*/

describe("cluster:ClusterSubscriberGroup", () => {

    //beforeEach(cleanup);
    //afterEach(cleanup);

    it("works when you can receive published messages to all primary nodes after having subscribed", async () => {

        // 0. Prepare the publisher and the subscriber
        const host = "127.0.0.1";
        const port: number = masters[0]
        const publisher: Cluster = new Cluster([{host: host, port: port}]);

        //-- Publisher
        // Verify that the cluster is configured with 3 master nodes
        publisher.on("ready", () => {
            expect(publisher.nodes("master").length).to.eql(3);
        });

        //-- Subscriber
        const subscriber: Cluster = new Cluster([{host: host, port: port}]);
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
});