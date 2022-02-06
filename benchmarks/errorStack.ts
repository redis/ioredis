import { cronometro } from "cronometro";
import Redis from "../lib/Redis";

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
    "showFriendlyErrorStack=true": {
      test() {
        return redis.set("foo", "bar");
      },
      before(cb) {
        redis = new Redis({ showFriendlyErrorStack: true });
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
