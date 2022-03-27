import { expectType } from "tsd";
import Redis from "../../built";

interface User {
  name: string;
  title: string;
}

const user: User = { name: "Bob", title: "Engineer" };
const stringMap = new Map([["key", "value"]]);
const numberMap = new Map([[42, "value"]]);
const bufferMap = new Map([[Buffer.from([0xff]), "value"]]);
const mixedMap = new Map<string | Buffer | number, string>([
  [Buffer.from([0xff]), "value"],
  [42, "value"],
  ["field", "value"],
]);

const redis = new Redis();

// mset
expectType<Promise<"OK">>(redis.mset("key1", "value1", "key2", "value2"));
expectType<Promise<"OK">>(redis.mset(user));
expectType<Promise<"OK">>(redis.mset(stringMap));
expectType<Promise<"OK">>(redis.mset(numberMap));
expectType<Promise<"OK">>(redis.mset(bufferMap));
expectType<Promise<"OK">>(redis.mset(mixedMap));

// msetnx
expectType<Promise<"OK">>(redis.msetnx(user));
expectType<Promise<"OK">>(redis.msetnx(stringMap));
expectType<Promise<"OK">>(redis.msetnx(numberMap));
expectType<Promise<"OK">>(redis.msetnx(bufferMap));
expectType<Promise<"OK">>(redis.msetnx(mixedMap));

// hmset
expectType<Promise<"OK">>(redis.hmset("key", user));
expectType<Promise<"OK">>(redis.hmset("key", stringMap));
expectType<Promise<"OK">>(redis.hmset("key", numberMap));
expectType<Promise<"OK">>(redis.hmset("key", bufferMap));
expectType<Promise<"OK">>(redis.hmset("key", mixedMap));

// hset
expectType<Promise<number>>(redis.hset("key", user));
expectType<Promise<number>>(redis.hset("key", stringMap));
expectType<Promise<number>>(redis.hset("key", numberMap));
expectType<Promise<number>>(redis.hset("key", bufferMap));
expectType<Promise<number>>(redis.hset("key", mixedMap));

// hgetall
expectType<Promise<Record<string, string>>>(redis.hgetall("key"));
