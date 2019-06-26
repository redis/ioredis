import { EventEmitter } from "events";
import { sample, Debug, noop, defaults } from "../utils";
import { IRedisOptions, getNodeKey, NodeKey, NodeRole } from "./util";
import Redis from "../redis";

const debug = Debug("cluster:connectionPool");

type NODE_TYPE = "all" | "master" | "slave";

export default class ConnectionPool extends EventEmitter {
  // master + slave = all
  private nodes: { [key in NODE_TYPE]: { [key: string]: any } } = {
    all: {},
    master: {},
    slave: {}
  };

  private specifiedOptions: { [key: string]: any } = {};

  constructor(private redisOptions) {
    super();
  }

  public getNodes(role: NodeRole = "all"): any[] {
    const nodes = this.nodes[role];
    return Object.keys(nodes).map(key => nodes[key]);
  }

  public getInstanceByKey(key: NodeKey): any {
    return this.nodes.all[key];
  }

  public getSampleInstance(role: NodeRole): any {
    const keys = Object.keys(this.nodes[role]);
    const sampleKey = sample(keys);
    return this.nodes[role][sampleKey];
  }

  /**
   * Find or create a connection to the node
   *
   * @param {IRedisOptions} node
   * @param {boolean} [readOnly=false]
   * @returns {*}
   * @memberof ConnectionPool
   */
  public findOrCreate(node: IRedisOptions, readOnly: boolean = false): any {
    const key = getNodeKey(node);
    readOnly = Boolean(readOnly);

    if (this.specifiedOptions[key]) {
      Object.assign(node, this.specifiedOptions[key]);
    } else {
      this.specifiedOptions[key] = node;
    }

    let redis;
    if (this.nodes.all[key]) {
      redis = this.nodes.all[key];
      if (redis.options.readOnly !== readOnly) {
        redis.options.readOnly = readOnly;
        debug("Change role of %s to %s", key, readOnly ? "slave" : "master");
        redis[readOnly ? "readonly" : "readwrite"]().catch(noop);
        if (readOnly) {
          delete this.nodes.master[key];
          this.nodes.slave[key] = redis;
        } else {
          delete this.nodes.slave[key];
          this.nodes.master[key] = redis;
        }
      }
    } else {
      debug("Connecting to %s as %s", key, readOnly ? "slave" : "master");
      redis = new Redis(
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
            readOnly: readOnly
          },
          node,
          this.redisOptions,
          { lazyConnect: true }
        )
      );
      this.nodes.all[key] = redis;
      this.nodes[readOnly ? "slave" : "master"][key] = redis;

      redis.once("end", () => {
        delete this.nodes.all[key];
        delete this.nodes.master[key];
        delete this.nodes.slave[key];
        this.emit("-node", redis, key);
        if (!Object.keys(this.nodes.all).length) {
          this.emit("drain");
        }
      });

      this.emit("+node", redis, key);

      redis.on("error", function(error) {
        this.emit("nodeError", error, key);
      });
    }

    return redis;
  }

  /**
   * Reset the pool with a set of nodes.
   * The old node will be removed.
   *
   * @param {(Array<string | number | object>)} nodes
   * @memberof ConnectionPool
   */
  public reset(nodes: IRedisOptions[]): void {
    debug("Reset with %O", nodes);
    const newNodes = {};
    nodes.forEach(node => {
      newNodes[getNodeKey(node)] = node;
    });

    Object.keys(this.nodes.all).forEach(key => {
      if (!newNodes[key]) {
        debug("Disconnect %s because the node does not hold any slot", key);
        this.nodes.all[key].disconnect();
      }
    });
    Object.keys(newNodes).forEach(key => {
      const node = newNodes[key];
      this.findOrCreate(node, node.readOnly);
    });
  }
}
