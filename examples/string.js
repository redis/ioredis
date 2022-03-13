const Redis = require("ioredis");
const redis = new Redis();

async function main() {
  const user = {
    name: "Bob",
    // The value of a Redis key can not be a number.
    // We can write `age: 20` here but ioredis will convert it to a string anyway.
    age: "20",
    description: "I am a programmer",
  };

  await redis.mset(user);

  const name = await redis.get("name");
  console.log(name); // "Bob"

  const age = await redis.get("age");
  console.log(age); // "20"

  const all = await redis.mget("name", "age", "description");
  console.log(all); // [ 'Bob', '20', 'I am a programmer' ]

  // or `await redis.del("name", "description")`;
  await redis.del(["name", "description"]);

  const exists = await redis.exists("name");
  console.log(exists); // 0 (means false, and if it's 1, it means true)

  await redis.incrby("age", 1);
  const newAge = await redis.get("age");
  console.log(newAge); // 21

  await redis.set("key_with_ttl", "hey", "EX", 1000);
  const ttl = await redis.ttl("key_with_ttl");
  console.log(ttl); // a number smaller or equal to 1000
}

main();
