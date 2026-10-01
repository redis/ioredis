const Redis = require("ioredis");
const redis = new Redis();

async function main() {
  await redis.set("foo", "bar");
  await redis.expire("foo", 10); // 10 seconds
  console.log(await redis.ttl("foo")); // a number smaller or equal to 10

  await redis.set("foo", "bar", "EX", 20);
  console.log(await redis.ttl("foo")); // a number smaller or equal to 20

  // expireat accepts unix time in seconds.
  await redis.expireat("foo", Math.round(Date.now() / 1000) + 30);
  console.log(await redis.ttl("foo")); // a number smaller or equal to 30

  // "XX" and other options are available since Redis 7.0.
  await redis.expireat("foo", Math.round(Date.now() / 1000) + 40, "XX");
  console.log(await redis.ttl("foo")); // a number smaller or equal to 40

  // expiretime is available since Redis 7.0.
  console.log(new Date((await redis.expiretime("foo")) * 1000));

  await redis.pexpire("foo", 10 * 1000); // unit is millisecond for pexpire.
  console.log(await redis.ttl("foo")); // a number smaller or equal to 10

  await redis.persist("foo"); // Remove the existing timeout on key "foo"
  console.log(await redis.ttl("foo")); // -1

  await redis.hset("hfoo", "hbar", "hfoobar");
  // hexpire is available since Redis 7.4.0
  await redis.hexpire("hfoo", 20, "FIELDS", 1, "hbar"); // Add TTL to hset field 
  console.log(await redis.call("httl", "hfoo", "FIELDS", "1", "hbar")); // [ 20 ]
  
  await redis.hpexpire("hfoo", 10 * 1000, "FIELDS", 1, "hbar"); // unit is millisecond for hpexpire
  console.log(await redis.call("httl", "hfoo", "FIELDS", "1", "hbar")); // [ 10 ]
}

main();
