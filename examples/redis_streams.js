const IORedis = require("ioredis");
const redis = new IORedis();

// you may find this read https://redis.io/topics/streams-intro
// very helpfull as a starter to understand the usescases and the parameters used

const f = async function () {
  const channel = "ioredis_channel";
  // specify the channel. you want to know how many messages
  // have been written in this channel
  let messageCount = await redis.xlen(channel);
  console.log(
    `current message count in channel ${channel} is ${messageCount} messages`
  );

  // specify channel to write a message into,
  // messages are key value
  const myMessage = "hello world";
  await redis.xadd(channel, "*", myMessage, "message");

  messageCount = await redis.xlen(channel);
  console.log(
    `current message count in channel ${channel} is ${messageCount} messages`
  );
  // now you can see we have one new message

  // use xread to read all messages in channel
  let messages = await redis.xread(["STREAMS", channel, 0]);
  messages = messages[0][1];
  console.log(
    `reading messages from channel ${channel}, found ${messages.length} messages`
  );
  for (let i = 0; i < messages.length; i++) {
    let msg = messages[i];
    msg = msg[1][0].toString();
    console.log("reading message:", msg);
  }
  process.exit(0);
};
f();
