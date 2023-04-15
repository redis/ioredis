import { expectType } from "tsd";
import { Redis } from "../../built";

const redis = new Redis();

expectType<Redis>(redis.on("connect", () => {}));
expectType<Redis>(redis.on("ready", () => {}));
expectType<Redis>(redis.on("close", () => {}));
expectType<Redis>(redis.on("end", () => {}));
expectType<Redis>(
  redis.on("error", (error) => {
    expectType<Error>(error);
  })
);

expectType<Redis>(redis.once("connect", () => {}));
expectType<Redis>(redis.once("ready", () => {}));
expectType<Redis>(redis.once("close", () => {}));
expectType<Redis>(redis.once("end", () => {}));
expectType<Redis>(
  redis.once("error", (error) => {
    expectType<Error>(error);
  })
);

redis.on("message", (channel, message) => {
  expectType<string>(channel);
  expectType<string>(message);
});

redis.on("messageBuffer", (channel, message) => {
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

redis.on("pmessage", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<string>(channel);
  expectType<string>(message);
});

redis.on("pmessageBuffer", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

redis.once("message", (channel, message) => {
  expectType<string>(channel);
  expectType<string>(message);
});

redis.once("messageBuffer", (channel, message) => {
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});

redis.once("pmessage", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<string>(channel);
  expectType<string>(message);
});

redis.once("pmessageBuffer", (pattern, channel, message) => {
  expectType<string>(pattern);
  expectType<Buffer>(channel);
  expectType<Buffer>(message);
});
