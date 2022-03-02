import Redis from "../built/Redis";

export { default as Cluster } from "../built/cluster";
export { default as Command } from "../built/command";
export { default as ScanStream } from "../built/ScanStream";
export { default as Pipeline } from "../built/pipeline";
export { default as AbstractConnector } from "../built/connectors/AbstractConnector";
export {
  default as SentinelConnector,
  SentinelIterator,
} from "../built/connectors/SentinelConnector";
export { SentinelAddress } from "../built/connectors/SentinelConnector";
export { RedisOptions } from "../built/redis/RedisOptions";
export const ReplyError = require("redis-errors").ReplyError;
export function print(err, reply) {
  if (err) {
    console.log("Error: " + err);
  } else {
    console.log("Reply: " + reply);
  }
}

export default Redis;
