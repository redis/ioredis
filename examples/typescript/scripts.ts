import Redis, { RedisCommander, Result, Callback } from "ioredis";
const redis = new Redis();

/**
 * Define our command
 */
redis.defineCommand("myecho", {
  numberOfKeys: 1,
  lua: "return KEYS[1] .. ARGV[1]",
});

// Add declarations
declare module "ioredis" {
  interface RedisCommander<Context> {
    myecho(
      key: string,
      argv: string,
      callback?: Callback<string>
    ): Result<string, Context>;
  }
}

// Works with callbacks
redis.myecho("key", "argv", (err, result) => {
  console.log("callback", result);
});

// Works with Promises
(async () => {
  console.log("promise", await redis.myecho("key", "argv"));
})();

// Works with pipelining
redis
  .pipeline()
  .myecho("key", "argv")
  .exec((err, result) => {
    console.log("pipeline", result);
  });
