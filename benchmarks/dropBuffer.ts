import { cronometro } from "cronometro";
import Redis from "../lib/redis";

let redis;

cronometro(
  {
    default: {
      test() {
        return redis.set("foo", "bar");
      },
      before(cb) {
        redis = new Redis();
        cb();
      },
      after(cb) {
        redis.quit();
        cb();
      },
    },
    "dropBufferSupport=true": {
      test() {
        return redis.set("foo", "bar");
      },
      before(cb) {
        redis = new Redis({ dropBufferSupport: true });
        cb();
      },
      after(cb) {
        redis.quit();
        cb();
      },
    },
  },
  {
    print: { compare: true },
  }
);
