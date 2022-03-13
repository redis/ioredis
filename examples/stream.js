const Redis = require("ioredis");
const redis = new Redis();
const pub = new Redis();

const processMessage = (message) => {
  console.log("Id: %s. Data: %O", message[0], message[1]);
};

async function listenForMessage(lastId = "$") {
  // `results` is an array, each element of which corresponds to a key.
  // Because we only listen to one key (mystream) here, `results` only contains
  // a single element. See more: https://redis.io/commands/xread#return-value
  const results = await redis.xread(
    "BLOCK",
    0,
    "STREAMS",
    "user-stream",
    lastId
  );
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
