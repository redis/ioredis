import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";

const DISCONNECT_TIMEOUT = 200;

/**
 * Resolves on the first `event`, or rejects after `ms` with the cluster state.
 */
function waitFor(cluster: Cluster, event: string, ms: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cluster.removeListener(event, onEvent);
      reject(
        new Error(
          `no "${event}" within ${ms}ms: status=${cluster.status}, ` +
            // @ts-expect-error
            `reconnectTimeout=${Boolean(cluster.reconnectTimeout)}, ` +
            // @ts-expect-error
            `offlineQueue=${cluster.offlineQueue.length}`
        )
      );
    }, ms);
    const onEvent = () => {
      clearTimeout(timer);
      resolve();
    };
    cluster.once(event, onEvent);
  });
}

describe("cluster:late node end", () => {
  const PORT_NODE_1 = 30001;
  const PORT_NODE_2 = 30002;
  const slotTable = [
    [0, 8000, ["127.0.0.1", PORT_NODE_1]],
    [8001, 16383, ["127.0.0.1", PORT_NODE_2]],
  ];

  it("should reconnect when a node ends while resolving the startup nodes", async () => {
    // [Setup] Configure Redis servers (2 mock nodes)
    // The first ready check fails, and the server keeps that socket half-open
    let readyChecks = 0;
    let slowPort: number | undefined;
    const redisServerHandler = (argv, c) => {
      if (argv[0] === "cluster" && argv[1].toLowerCase() === "info") {
        readyChecks++;
        // First ready check → failure
        if (readyChecks === 1) {
          slowPort = c.localPort;
          c.allowHalfOpen = true;
          return "cluster_state:fail";
        }
        // Other ready checks → success
        return "cluster_state:ok";
      }
      if (argv[0] === "get") {
        return "bar";
      }
    };
    new MockServer(PORT_NODE_1, redisServerHandler, slotTable);
    new MockServer(PORT_NODE_2, redisServerHandler, slotTable);

    // [Setup] Configure DNS lookup
    // The lookup made by the reconnection only resolves once the slow node has ended.
    let lookups = 0;
    let slowNodeEndedDuringLookup = false;
    const cluster = new Cluster(
      [
        {
          host: "redis.test", // Use a hostname instead of an IP to force one dnsLookup() per connect()
          port: PORT_NODE_1,
        },
      ],
      {
        redisOptions: { disconnectTimeout: DISCONNECT_TIMEOUT },
        dnsLookup(hostname, callback) {
          lookups++;

          // Only the 2nd lookup resolves late (after the slow node has ended)
          if (lookups === 2) {
            const onNodeEnd = (redis) => {
              if (redis.options.port !== slowPort) return;
              cluster.removeListener("-node", onNodeEnd);
              slowNodeEndedDuringLookup = true;
              setImmediate(() => callback(null, "127.0.0.1"));
            };
            cluster.on("-node", onNodeEnd);
          } else {
            callback(null, "127.0.0.1");
          }
        },
      }
    );

    // Sent during the incident: queued until the cluster is ready.
    const pending = cluster.get("foo");

    try {
      await waitFor(cluster, "ready", 5 * DISCONNECT_TIMEOUT);

      expect(slowNodeEndedDuringLookup).to.eql(true);
      expect(readyChecks).to.eql(2);
      expect(await pending).to.eql("bar");
    } finally {
      cluster.disconnect();
    }
  });
});
