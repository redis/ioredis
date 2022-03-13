const Redis = require("ioredis");
const redis = new Redis();

async function main() {
  const numbers = [1, 3, 5, 7, 9];
  await redis.sadd("user-set", numbers);

  const elementCount = await redis.scard("user-set");
  console.log(elementCount); // 5

  await redis.sadd("user-set", "1");
  const newElementCount = await redis.scard("user-set");
  console.log(newElementCount); // 5

  const isMember = await redis.sismember("user-set", 3);
  console.log(isMember); // 1 (means true, and if it's 0, it means false)
}

main();
