const Redis = require("ioredis");
const redis = new Redis();

async function main() {
  const scores = [
    { name: "Bob", score: 80 },
    { name: "Jeff", score: 59.5 },
    { name: "Tom", score: 100 },
    { name: "Alex", score: 99.5 },
  ];
  await redis.zadd(
    "user-zset",
    ...scores.map(({ name, score }) => [score, name])
  );

  console.log(await redis.zrange("user-zset", 2, 3)); // [ 'Alex', 'Tom' ]
  console.log(await redis.zrange("user-zset", 2, 3, "WITHSCORES")); // [ 'Alex', '99.5', 'Tom', '100' ]
  console.log(await redis.zrange("user-zset", 2, 3, "REV")); // [ 'Bob', 'Jeff' ]
  console.log(await redis.zrange("user-zset", 80, 100, "BYSCORE")); // [ 'Bob', 'Alex', 'Tom' ]
  console.log(await redis.zrange("user-zset", 2, 3)); // [ 'Alex', 'Tom' ]
}

main();
