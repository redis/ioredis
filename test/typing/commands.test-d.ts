import { expectError, expectType } from "tsd";
import { Redis } from "../../built";

const redis = new Redis();

// call
expectType<Promise<unknown>>(redis.call("info"));
expectType<Promise<unknown>>(redis.call("set", "foo", "bar"));
expectType<Promise<unknown>>(redis.call("set", ["foo", "bar"]));
expectType<Promise<unknown>>(redis.callBuffer("set", ["foo", "bar"]));
expectType<Promise<unknown>>(
  redis.call("set", ["foo", "bar"], (err, value) => {
    expectType<Error | undefined | null>(err);
    expectType<unknown | undefined>(value);
  })
);

expectType<Promise<unknown>>(
  redis.call("get", "foo", (err, value) => {
    expectType<Error | undefined | null>(err);
    expectType<unknown | undefined>(value);
  })
);

expectType<Promise<unknown>>(
  redis.call("info", (err, value) => {
    expectType<Error | undefined | null>(err);
    expectType<unknown | undefined>(value);
  })
);

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

// HGETALL
expectType<Promise<Record<string, string>>>(redis.hgetall("key"));
expectType<Promise<Record<string, Buffer>>>(redis.hgetallBuffer("key"));

// Hash field expiration commands
expectType<Promise<number[]>>(
  redis.hexpireat("key", 1_700_000_000, "FIELDS", 1, "field")
);
expectType<Promise<number[]>>(redis.hexpiretime("key", "FIELDS", 1, "field"));
expectType<Promise<(string | null)[]>>(
  redis.hgetdel("key", "FIELDS", 1, "field")
);
expectType<Promise<(Buffer | null)[]>>(
  redis.hgetdelBuffer("key", "FIELDS", 1, "field")
);
expectType<Promise<(string | null)[]>>(
  redis.hgetex("key", "FIELDS", 1, "field")
);
expectType<Promise<(Buffer | null)[]>>(
  redis.hgetexBuffer("key", "FIELDS", 1, "field")
);
expectType<Promise<(string | null)[]>>(
  redis.hgetex("key", "EX", 60, "FIELDS", 1, "field")
);
expectType<Promise<(string | null)[]>>(
  redis.hgetex("key", "PXAT", 1_700_000_000_000, "FIELDS", 1, "field")
);
expectType<Promise<(string | null)[]>>(
  redis.hgetex("key", "PERSIST", "FIELDS", 1, "field")
);
expectType<Promise<number[]>>(redis.hpersist("key", "FIELDS", 1, "field"));
expectType<Promise<number[]>>(
  redis.hpexpireat("key", 1_700_000_000_000, "FIELDS", 1, "field")
);
expectType<Promise<number[]>>(redis.hpexpiretime("key", "FIELDS", 1, "field"));
expectType<Promise<number[]>>(redis.hpttl("key", "FIELDS", 1, "field"));
expectType<Promise<number>>(redis.hsetex("key", "FIELDS", 1, "field", "value"));
expectType<Promise<number[]>>(redis.httl("key", "FIELDS", 1, "field"));

// LPOP
expectType<Promise<string | null>>(redis.lpop("key"));
expectType<Promise<Buffer | null>>(redis.lpopBuffer("key"));
expectType<Promise<string[] | null>>(redis.lpop("key", 17));
expectType<Promise<Buffer[] | null>>(redis.lpopBuffer("key", 17));

// LMOVEM / BLMOVEM
expectType<Promise<string[] | null>>(
  redis.lmovem("source", "destination", "LEFT", "RIGHT")
);
expectType<Promise<string[] | null>>(
  redis.lmovem(
    "source",
    "destination",
    "LEFT",
    "RIGHT",
    "COUNT",
    2,
    "BULK"
  )
);
expectType<Promise<Buffer[] | null>>(
  redis.lmovemBuffer(
    "source",
    "destination",
    "RIGHT",
    "LEFT",
    "EXACTLY",
    "2",
    "OBO"
  )
);
expectType<Promise<string[] | null>>(
  redis.blmovem(
    "source",
    "destination",
    "LEFT",
    "RIGHT",
    0,
    "COUNT",
    2,
    "BULK"
  )
);
expectType<Promise<Buffer[] | null>>(
  redis.blmovemBuffer("source", "destination", "RIGHT", "LEFT", "0")
);

// LPOS
expectType<Promise<number | null>>(redis.lpos("key", "element"));
expectType<Promise<number[]>>(
  redis.lpos("key", "element", "RANK", -1, "COUNT", 2)
);

// SRANDMEMBER
expectType<Promise<string | null>>(redis.srandmember("key"));
expectType<Promise<Buffer | null>>(redis.srandmemberBuffer("key"));
expectType<Promise<string[]>>(redis.srandmember("key", 10));
expectType<Promise<Buffer[]>>(redis.srandmemberBuffer("key", 10));

// LMISMEMBER
expectType<Promise<number[]>>(redis.smismember("key", "e1", "e2"));

// ZADD
expectType<Promise<number>>(redis.zadd("key", 1, "member"));
expectType<Promise<number>>(redis.zadd("key", "CH", 1, "member"));

// ZINTER / ZUNION COUNT
expectType<Promise<string[]>>(
  redis.zinter(3, "s1", "s2", "s3", "AGGREGATE", "COUNT")
);
expectType<Promise<string[]>>(
  redis.zinter(3, "s1", "s2", "s3", "AGGREGATE", "COUNT", "WITHSCORES")
);
expectType<Promise<number>>(
  redis.zinterstore("out", 3, "s1", "s2", "s3", "AGGREGATE", "COUNT")
);
expectType<Promise<string[]>>(
  redis.zunion(3, "s1", "s2", "s3", "AGGREGATE", "COUNT")
);
expectType<Promise<string[]>>(
  redis.zunion(3, "s1", "s2", "s3", "AGGREGATE", "COUNT", "WITHSCORES")
);
expectType<Promise<number>>(
  redis.zunionstore("out", 3, "s1", "s2", "s3", "AGGREGATE", "COUNT")
);

// ZRANDMEMBER
expectType<Promise<string | null>>(redis.zrandmember("key"));
expectType<Promise<string[]>>(redis.zrandmember("key", 20));

// ZSCORE
expectType<Promise<string | null>>(redis.zscore("key", "member"));
expectType<Promise<Buffer | null>>(redis.zscoreBuffer("key", "member"));

// Vector set commands
expectType<Promise<number>>(redis.vcard("key"));
expectType<Promise<string | null>>(redis.vgetattr("key", "element"));
expectType<Promise<Buffer | null>>(redis.vgetattrBuffer("key", "element"));
expectType<Promise<string | null>>(redis.vrandmember("key"));
expectType<Promise<Buffer | null>>(redis.vrandmemberBuffer("key"));
expectType<Promise<string[]>>(redis.vrandmember("key", 10));
expectType<Promise<Buffer[]>>(redis.vrandmemberBuffer("key", 10));
expectType<Promise<string[]>>(redis.vrange("key", "-", "+"));
expectType<Promise<Buffer[]>>(redis.vrangeBuffer("key", "-", "+"));
expectType<Promise<string[]>>(redis.vrange("key", "-", "+", 10));
expectType<Promise<Buffer[]>>(redis.vrangeBuffer("key", "-", "+", 10));

// GETRANGE
expectType<Promise<Buffer>>(redis.getrangeBuffer("foo", 0, 1));

// Array commands
expectType<Promise<number>>(redis.arcount("key"));
expectType<Promise<number>>(redis.ardel("key", 0, 1));
expectType<Promise<number>>(redis.ardelrange("key", 0, 2));
expectType<Promise<string | null>>(redis.arget("key", 0));
expectType<Promise<Buffer | null>>(redis.argetBuffer("key", 0));
expectType<Promise<(string | null)[]>>(redis.argetrange("key", 0, 2));
expectType<Promise<(Buffer | null)[]>>(redis.argetrangeBuffer("key", 0, 2));
expectError(redis.argrep("key", 0, 4));
expectType<Promise<number[]>>(redis.argrep("key", 0, 4, "MATCH", "alpha"));
expectType<Promise<Array<[index: number, value: string]>>>(
  redis.argrep("key", 0, 4, "MATCH", "alpha", "WITHVALUES", "NOCASE")
);
expectType<Promise<Array<[index: number, value: Buffer]>>>(
  redis.argrepBuffer("key", 0, 4, "MATCH", "alpha", "WITHVALUES")
);
expectType<Promise<(string | number)[]>>(redis.arinfo("key"));
expectType<Promise<(Buffer | number)[]>>(redis.arinfoBuffer("key", "FULL"));
expectType<Promise<number>>(redis.arinsert("key", "a", "b"));
expectType<Promise<(string | null)[]>>(redis.arlastitems("key", 2));
expectType<Promise<(Buffer | null)[]>>(redis.arlastitemsBuffer("key", 2, "REV"));
expectType<Promise<number>>(redis.arlen("key"));
expectType<Promise<(string | null)[]>>(redis.armget("key", 0, 1));
expectType<Promise<(Buffer | null)[]>>(redis.armgetBuffer("key", 0, 1));
expectType<Promise<number>>(redis.armset("key", 0, "a", 1, "b"));
expectType<Promise<number | null>>(redis.arnext("key"));
expectType<Promise<string | null>>(redis.arop("key", 0, 2, "SUM"));
expectType<Promise<Buffer | null>>(redis.aropBuffer("key", 0, 2, "SUM"));
expectType<Promise<number | null>>(redis.arop("key", 0, 2, "AND"));
expectType<Promise<number>>(redis.arop("key", 0, 2, "USED"));
expectType<Promise<number>>(redis.arop("key", 0, 2, "MATCH", "a"));
expectType<Promise<number>>(redis.arring("key", 3, "a", "b"));
expectType<Promise<Array<[index: number, value: string]>>>(
  redis.arscan("key", 0, 2)
);
expectType<Promise<Array<[index: number, value: Buffer]>>>(
  redis.arscanBuffer("key", 0, 2)
);
expectType<Promise<number>>(redis.arseek("key", 0));
expectType<Promise<number>>(redis.arset("key", 0, "a", "b"));

// Callbacks
redis.getBuffer("foo", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<Buffer | null | undefined>(res);
});

redis.hgetdelBuffer("key", "FIELDS", 1, "field", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<(Buffer | null)[] | undefined>(res);
});

redis.hgetexBuffer("key", "EX", 60, "FIELDS", 1, "field", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<(Buffer | null)[] | undefined>(res);
});

redis.blmovem(
  "source",
  "destination",
  "LEFT",
  "RIGHT",
  0,
  "EXACTLY",
  2,
  "OBO",
  (err, res) => {
    expectType<Error | null | undefined>(err);
    expectType<string[] | null | undefined>(res);
  }
);

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

redis.argrep("key", 0, 4, "MATCH", "alpha", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<number[] | undefined>(res);
});

redis.arop("key", 0, 2, "SUM", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<string | null | undefined>(res);
});

// XNACK
expectType<Promise<number>>(
  redis.xnack("stream", "group", "FAIL", "IDS", 1, "0-0")
);
expectType<Promise<number>>(
  redis.xnack("stream", "group", "SILENT", "IDS", 1, "0-0")
);
expectType<Promise<number>>(
  redis.xnack("stream", "group", "FATAL", "IDS", 1, "0-0")
);
expectType<Promise<number>>(
  redis.xnack("stream", "group", "FAIL", "IDS", 1, "0-0", "RETRYCOUNT", 7)
);
expectType<Promise<number>>(
  redis.xnack("stream", "group", "FAIL", "IDS", 1, "0-0", "FORCE")
);

redis.xnack("stream", "group", "FAIL", "IDS", 1, "0-0", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<number | undefined>(res);
});

redis.zunion(3, "s1", "s2", "s3", "AGGREGATE", "COUNT", (err, res) => {
  expectType<Error | null | undefined>(err);
  expectType<string[] | undefined>(res);
});

redis.zunionstore(
  "out",
  3,
  "s1",
  "s2",
  "s3",
  "AGGREGATE",
  "COUNT",
  (err, res) => {
    expectType<Error | null | undefined>(err);
    expectType<number | undefined>(res);
  }
);
