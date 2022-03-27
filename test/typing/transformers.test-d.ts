import { expectType } from "tsd";
import Redis from "../../built";

interface User {
  name: string;
  title: string;
}

const user: User = { name: "Bob", title: "Engineer" };
const map = new Map([["key", "value"]]);

const redis = new Redis();

// mset
expectType<Promise<"OK">>(redis.mset(user));
expectType<Promise<"OK">>(redis.mset(map));

// msetnx
expectType<Promise<"OK">>(redis.msetnx(user));
expectType<Promise<"OK">>(redis.msetnx(map));

// hmset
expectType<Promise<"OK">>(redis.hmset("key", user));
expectType<Promise<"OK">>(redis.hmset("key", map));

// hset
expectType<Promise<number>>(redis.hset("key", user));
expectType<Promise<number>>(redis.hset("key", map));

// hgetall
expectType<Promise<Record<string, string>>>(redis.hgetall("key"));
