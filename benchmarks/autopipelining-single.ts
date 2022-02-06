import { cronometro } from "cronometro";
import { readFileSync } from "fs";
import { join } from "path";
import Redis from "../lib/Redis";

const iterations = parseInt(process.env.ITERATIONS || "10000", 10);
const batchSize = parseInt(process.env.BATCH_SIZE || "1000", 10);
const keys = readFileSync(
  join(__dirname, "fixtures/cluster-3.txt"),
  "utf-8"
).split("\n");
let redis;

function command(): string {
  const choice = Math.random();

  if (choice < 0.3) {
    return "ttl";
  } else if (choice < 0.6) {
    return "exists";
  }

  return "get";
}

function test() {
  const index = Math.floor(Math.random() * keys.length);

  return Promise.all(
    Array.from(Array(batchSize)).map(() => redis[command()](keys[index]))
  );
}

function after(cb) {
  redis.quit();
  cb();
}

cronometro(
  {
    default: {
      test,
      before(cb) {
        redis = new Redis();

        cb();
      },
      after,
    },
    "enableAutoPipelining=true": {
      test,
      before(cb) {
        redis = new Redis({ enableAutoPipelining: true });
        cb();
      },
      after,
    },
  },
  {
    iterations,
    print: { compare: true },
  }
);
