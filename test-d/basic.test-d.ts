import { expectError, expectType } from "tsd";
import Redis from "../built";

const redis = new Redis();

// GET
expectType<Promise<string | null>>(redis.get("key"));
expectError(redis.get("key", "bar"));

// SET
expectType<Promise<"OK">>(redis.set("key", "bar"));
expectType<Promise<"OK">>(redis.set("key", "bar", "EX", 100));
expectError(redis.set("key", "bar", "EX", "NX"));
expectType<Promise<"OK" | null>>(redis.set("key", "bar", "EX", 100, "NX")); // NX can fail thus `null` is returned
expectType<Promise<string | null>>(redis.set("key", "bar", "GET"));

// INCR
expectType<Promise<number>>(redis.incr("key"));
expectType<Promise<number>>(redis.incrby("key", 42));
expectType<Promise<number>>(redis.incrby("key", "42"));
expectType<Promise<string>>(redis.incrbyfloat("key", "42"));

// MGET
expectType<Promise<(string | null)[]>>(redis.mget("key", "bar"));
expectType<Promise<(string | null)[]>>(redis.mget(["key", "bar"]));

// LPOP
expectType<Promise<string | null>>(redis.lpop("key"));
expectType<Promise<Buffer | null>>(redis.lpopBuffer("key"));
expectType<Promise<string[] | null>>(redis.lpop("key", 17));
expectType<Promise<Buffer[] | null>>(redis.lpopBuffer("key", 17));

// LPOS
expectType<Promise<number | null>>(redis.lpos("key", "element"));
expectType<Promise<number[]>>(
  redis.lpos("key", "element", "RANK", -1, "COUNT", 2)
);

// ZADD
expectType<Promise<number>>(redis.zadd("key", 1, "member"));
expectType<Promise<number>>(redis.zadd("key", "CH", 1, "member"));
