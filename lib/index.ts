import Redis from "./Redis";

export { default as Cluster } from "./cluster";
export { default as Command } from "./command";
export { default as ScanStream } from "./ScanStream";
export { default as Pipeline } from "./pipeline";
export { default as AbstractConnector } from "./connectors/AbstractConnector";
export {
  default as SentinelConnector,
  SentinelIterator,
} from "./connectors/SentinelConnector";

// Type Exports
export { ISentinelAddress } from "./connectors/SentinelConnector";
export { RedisOptions } from "./redis/RedisOptions";

// No TS typings
export const ReplyError = require("redis-errors").ReplyError;

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

export function print(err: Error | null, reply?: any) {
  if (err) {
    console.log("Error: " + err);
  } else {
    console.log("Reply: " + reply);
  }
}

export default Redis;
