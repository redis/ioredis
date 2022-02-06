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

const PromiseContainer = require("./promiseContainer");
Object.defineProperty(exports, "Promise", {
  get() {
    return PromiseContainer.get();
  },
  set(lib) {
    PromiseContainer.set(lib);
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
