import { EventEmitter } from "events";
import { sample, Debug, noop, defaults } from "../utils";
import { RedisOptions, getNodeKey, NodeKey, NodeRole } from "./util";
import Redis from "../Redis";

const debug = Debug("cluster:connectionPool");

type NODE_TYPE = "all" | "master" | "slave";

type Node = {
  redis: Redis;
  endListener: () => void;
  errorListener: (error: unknown) => void;
};

export default class ConnectionPool extends EventEmitter {
  // master + slave = all
  private nodes: { [key in NODE_TYPE]: { [key: string]: Node } } = {
    all: {},
    master: {},
    slave: {},
  };

  private specifiedOptions: { [key: string]: any } = {};

  constructor(private redisOptions) {
    super();
  }

  getNodes(role: NodeRole = "all"): Redis[] {
    const nodes = this.nodes[role];
    return Object.keys(nodes).map((key) => nodes[key].redis);
  }

  getInstanceByKey(key: NodeKey): Redis {
    return this.nodes.all[key].redis;
  }

  getSampleInstance(role: NodeRole): Redis {
    const keys = Object.keys(this.nodes[role]);
    const sampleKey = sample(keys);
    return this.nodes[role][sampleKey].redis;
  }

  /**
   * Find or create a connection to the node
   */
  findOrCreate(redisOptions: RedisOptions, readOnly = false): Node {
    const key = getNodeKey(redisOptions);
    readOnly = Boolean(readOnly);

    if (this.specifiedOptions[key]) {
      Object.assign(redisOptions, this.specifiedOptions[key]);
    } else {
      this.specifiedOptions[key] = redisOptions;
    }

    let node: Node;
    if (this.nodes.all[key]) {
      node = this.nodes.all[key];
      if (node.redis.options.readOnly !== readOnly) {
        node.redis.options.readOnly = readOnly;
        debug("Change role of %s to %s", key, readOnly ? "slave" : "master");
        node.redis[readOnly ? "readonly" : "readwrite"]().catch(noop);
        if (readOnly) {
          delete this.nodes.master[key];
          this.nodes.slave[key] = node;
        } else {
          delete this.nodes.slave[key];
          this.nodes.master[key] = node;
        }
      }
    } else {
      debug("Connecting to %s as %s", key, readOnly ? "slave" : "master");
      const redis = new Redis(
        defaults(
          {
            // Never try to reconnect when a node is lose,
            // instead, waiting for a `MOVED` error and
            // fetch the slots again.
            retryStrategy: null,
            // Offline queue should be enabled so that
            // we don't need to wait for the `ready` event
            // before sending commands to the node.
            enableOfflineQueue: true,
            readOnly: readOnly,
          },
          redisOptions,
          this.redisOptions,
          { lazyConnect: true }
        )
      );
      const endListener = () => {
        this.removeNode(key);
        this.emit("-node", redis, key);
        if (!Object.keys(this.nodes.all).length) {
          this.emit("drain");
        }
      };
      const errorListener = (error: unknown) => {
        this.emit("nodeError", error, key);
      };
      node = { redis, endListener, errorListener };

      this.nodes.all[key] = node;
      this.nodes[readOnly ? "slave" : "master"][key] = node;

      redis.once("end", endListener);

      this.emit("+node", redis, key);

      redis.on("error", errorListener);
    }

    return node;
  }

  /**
   * Reset the pool with a set of nodes.
   * The old node will be removed.
   */
  reset(nodes: RedisOptions[]): void {
    debug("Reset with %O", nodes);
    const newNodes = {};
    nodes.forEach((node) => {
      const key = getNodeKey(node);

      // Don't override the existing (master) node
      // when the current one is slave.
      if (!(node.readOnly && newNodes[key])) {
        newNodes[key] = node;
      }
    });

    Object.keys(this.nodes.all).forEach((key) => {
      if (!newNodes[key]) {
        debug("Disconnect %s because the node does not hold any slot", key);
        this.nodes.all[key].redis.disconnect();
        this.removeNode(key);
      }
    });
    Object.keys(newNodes).forEach((key) => {
      const node = newNodes[key];
      this.findOrCreate(node, node.readOnly);
    });
  }

  /**
   * Remove a node from the pool.
   */
  private removeNode(key: string): void {
    const { nodes } = this;
    if (nodes.all[key]) {
      debug("Remove %s from the pool", key);
      delete nodes.all[key];
    }
    delete nodes.master[key];
    delete nodes.slave[key];
  }
}
