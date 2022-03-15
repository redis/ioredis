const Redis = require("ioredis");
const redis = new Redis();
const sub = new Redis();
const pub = new Redis();

// Usage 1: As message hub
const processMessage = (message) => {
  console.log("Id: %s. Data: %O", message[0], message[1]);
};

async function listenForMessage(lastId = "$") {
  // `results` is an array, each element of which corresponds to a key.
  // Because we only listen to one key (mystream) here, `results` only contains
  // a single element. See more: https://redis.io/commands/xread#return-value
  const results = await sub.xread("BLOCK", 0, "STREAMS", "user-stream", lastId);
  const [key, messages] = results[0]; // `key` equals to "user-stream"

  messages.forEach(processMessage);

  // Pass the last id of the results to the next round.
  await listenForMessage(messages[messages.length - 1][0]);
}

listenForMessage();

setInterval(() => {
  // `redis` is in the block mode due to `redis.xread('BLOCK', ....)`,
  // so we use another connection to publish messages.
  pub.xadd("user-stream", "*", "name", "John", "age", "20");
}, 1000);

// Usage 2: As a list
async function main() {
  redis
    .pipeline()
    .xadd("list-stream", "*", "id", "item1")
    .xadd("list-stream", "*", "id", "item2")
    .xadd("list-stream", "*", "id", "item3")
    .exec();

  const items = await redis.xrange("list-stream", "-", "+", "COUNT", 2);
  console.log(items);
  // [
  //   [ '1647321710097-0', [ 'id', 'item1' ] ],
  //   [ '1647321710098-0', [ 'id', 'item2' ] ]
  // ]
}

main();
