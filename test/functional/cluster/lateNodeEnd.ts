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
  it("should reconnect when a node ends while resolving the startup nodes", async () => {
    const slotTable = [
      [0, 8000, ["127.0.0.1", 30001]],
      [8001, 16383, ["127.0.0.1", 30002]],
    ];

    // The first ready check reports a failed cluster (e.g. during a failover),
    // so ioredis calls `disconnect(true)`. The node that answers it does not
    // answer the FIN: its `end` only comes when ioredis destroys the socket,
    // after `disconnectTimeout`.
    let readyChecks = 0;
    let slowPort: number | undefined;
    const handler = (argv, c) => {
      if (argv[0] === "cluster" && argv[1].toLowerCase() === "info") {
        readyChecks += 1;
        if (readyChecks === 1) {
          slowPort = c.localPort;
          c.allowHalfOpen = true;
          return "cluster_state:fail";
        }
        return "cluster_state:ok";
      }
      if (argv[0] === "get") {
        return "bar";
      }
    };
    new MockServer(30001, handler, slotTable);
    new MockServer(30002, handler, slotTable);

    // The lookup of the reconnection lasts until the slow node has ended.
    let lookups = 0;
    let slowNodeEndedDuringLookup = false;
    const cluster = new Cluster([{ host: "redis.test", port: 30001 }], {
      redisOptions: { disconnectTimeout: DISCONNECT_TIMEOUT },
      dnsLookup(hostname, callback) {
        lookups += 1;
        if (lookups !== 2) {
          callback(null, "127.0.0.1");
          return;
        }
        const onNodeEnd = (redis) => {
          if (redis.options.port !== slowPort) return;
          cluster.removeListener("-node", onNodeEnd);
          slowNodeEndedDuringLookup = true;
          setImmediate(() => callback(null, "127.0.0.1"));
        };
        cluster.on("-node", onNodeEnd);
      },
    });

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
