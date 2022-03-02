import Redis from "./Redis";

module.exports = Redis;

export { default as Cluster } from "./cluster";

/**
 * @ignore
 */
export { default as Command } from "./command";

/**
 * @ignore
 */
export { default as ScanStream } from "./ScanStream";

/**
 * @ignore
 */
export { default as Pipeline } from "./pipeline";

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

// Type Exports
export { SentinelAddress } from "./connectors/SentinelConnector";
export { RedisOptions } from "./redis/RedisOptions";

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
  set(lib: unknown) {
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
