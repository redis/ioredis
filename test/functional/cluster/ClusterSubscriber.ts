import ConnectionPool from "../../../lib/cluster/ConnectionPool";
import ClusterSubscriber from "../../../lib/cluster/ClusterSubscriber";
import { EventEmitter } from "events";
import MockServer from "../../helpers/mock_server";
import { expect } from "chai";

describe("ClusterSubscriber", () => {
  it("cleans up subscribers when selecting a new one", async () => {
    const pool = new ConnectionPool({});
    const subscriber = new ClusterSubscriber(pool, new EventEmitter());

    let rejectSubscribes = false;
    const server = new MockServer(30000, (argv) => {
      if (rejectSubscribes && argv[0] === "subscribe") {
        return new Error("Failed to subscribe");
      }
      return "OK";
    });

    pool.findOrCreate({ host: "127.0.0.1", port: 30000 });

    subscriber.start();
    await subscriber.getInstance().subscribe("foo");
    rejectSubscribes = true;

    subscriber.start();
    await subscriber.getInstance().echo("hello");

    subscriber.start();
    await subscriber.getInstance().echo("hello");

    expect(server.getAllClients()).to.have.lengthOf(1);
    subscriber.stop();
    pool.reset([]);
  });
});
