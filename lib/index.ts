exports = module.exports = require("./Redis").default;

export { default } from "./Redis";
export { default as Redis } from "./Redis";
export { default as Cluster } from "./cluster";

/**
 * @ignore
 */
export { default as Command } from "./Command";

/**
 * @ignore
 */
export {
  default as RedisCommander,
  Result,
  ClientContext,
} from "./utils/RedisCommander";

/**
 * @ignore
 */
export { default as ScanStream } from "./ScanStream";

/**
 * @ignore
 */
export { default as Pipeline } from "./Pipeline";

/**
 * @ignore
 */
export { default as AbstractConnector } from "./connectors/AbstractConnector";

/**
 * @ignore
 */
export {
  default as SentinelConnector,
  SentinelIterator,
} from "./connectors/SentinelConnector";

/**
 * @ignore
 */
export { Callback } from "./types";

// Type Exports
export {
  SentinelAddress,
  SentinelConnectionOptions,
} from "./connectors/SentinelConnector";
export { StandaloneConnectionOptions } from "./connectors/StandaloneConnector";
export { RedisOptions, CommonRedisOptions } from "./redis/RedisOptions";
export { ClusterNode } from "./cluster";
export {
  ClusterOptions,
  DNSLookupFunction,
  DNSResolveSrvFunction,
  NatMap,
} from "./cluster/ClusterOptions";
export { NodeRole } from "./cluster/util";
export type {
  RedisKey,
  RedisValue,
  ChainableCommander,
} from "./utils/RedisCommander";

// No TS typings
export const ReplyError = require("redis-errors").ReplyError;

/**
 * @ignore
 */
Object.defineProperty(exports, "Promise", {
  get() {
    console.warn(
      "ioredis v5 does not support plugging third-party Promise library anymore. Native Promise will be used."
    );
    return Promise;
  },
  set(_lib: unknown) {
    console.warn(
      "ioredis v5 does not support plugging third-party Promise library anymore. Native Promise will be used."
    );
  },
});

/**
 * @ignore
 */
export function print(err: Error | null, reply?: any) {
  if (err) {
    console.log("Error: " + err);
  } else {
    console.log("Reply: " + reply);
  }
}
