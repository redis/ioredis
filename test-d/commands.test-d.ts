import { expectError, expectType } from "tsd";
import Redis from "../built";

const redis = new Redis();

// call
expectType<Promise<unknown>>(redis.call('info'));
expectType<Promise<unknown>>(redis.call('set', 'foo', 'bar'));
expectType<Promise<unknown>>(redis.call('set', ['foo', 'bar']));
expectType<Promise<unknown>>(redis.call('set', ['foo', 'bar'], (err, value) => {
  expectType<Error | undefined | null>(err);
  expectType<unknown | undefined>(value);
}));

expectType<Promise<unknown>>(redis.call('get', 'foo', (err, value) => {
  expectType<Error | undefined | null>(err);
  expectType<unknown | undefined>(value);
}));

expectType<Promise<unknown>>(redis.call('info', (err, value) => {
  expectType<Error | undefined | null>(err);
  expectType<unknown | undefined>(value);
}));

// GET
expectType<Promise<string | null>>(redis.get("key"));
expectType<Promise<Buffer | null>>(redis.getBuffer("key"));
expectError(redis.get("key", "bar"));

// SET
expectType<Promise<"OK">>(redis.set("key", "bar"));
expectType<Promise<"OK">>(redis.set("key", "bar", "EX", 100));
expectType<Promise<"OK" | null>>(redis.set("key", "bar", "EX", 100, "NX")); // NX can fail thus `null` is returned
expectType<Promise<string | null>>(redis.set("key", "bar", "GET"));

// DEL
expectType<Promise<number>>(redis.del("key"));
expectType<Promise<number>>(redis.del(["key1", "key2"]));
expectType<Promise<number>>(redis.del("key1", "key2"));

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

// LMISMEMBER
expectType<Promise<number[]>>(redis.smismember("key", "e1", "e2"));

// ZADD
expectType<Promise<number>>(redis.zadd("key", 1, "member"));
expectType<Promise<number>>(redis.zadd("key", "CH", 1, "member"));

// ZRANDMEMBER
expectType<Promise<string | null>>(redis.zrandmember("key"));
expectType<Promise<string[]>>(redis.zrandmember("key", 20));

// GETRANGE
expectType<Promise<Buffer>>(redis.getrangeBuffer("foo", 0, 1));

// Callbacks
redis.getBuffer("foo", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<Buffer | null | undefined>(res);
});

redis.set("foo", "bar", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<"OK" | undefined>(res);
});

redis.set("foo", "bar", "GET", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<string | null | undefined>(res);
});

redis.del("key1", "key2", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<number | undefined>(res);
});

redis.del(["key1", "key2"], (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<number | undefined>(res);
});
