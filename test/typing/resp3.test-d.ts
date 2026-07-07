import { expectType } from "tsd";
import { Cluster, Redis } from "../../built";

const r2 = new Redis({ protocol: 2 });
const r2Protocol3 = new Redis({ protocol: 3, replyMapping: "legacy" });
const r3 = new Redis({ protocol: 3, replyMapping: "resp3" });

const c2 = new Cluster([]);
const c3 = new Cluster([], { redisOptions: { replyMapping: "resp3" } });

type ScoredMember = [member: string, score: number];
type ScoredBufferMember = [member: Buffer, score: number];
type VsimAttributes = [score: number, attributes: string | null];
type VsimBufferAttributes = [score: number, attributes: Buffer | null];

// Inline protocol-only options still use the legacy/RESP2 reply mapping.
expectType<Promise<string | null>>(r2Protocol3.zscore("key", "member"));

// DOUBLE replies.
expectType<Promise<string | null>>(r2.zscore("key", "member"));
expectType<Promise<number | null>>(r3.zscore("key", "member"));

// Duplicates preserve the inferred reply mapping unless explicitly overridden.
expectType<Promise<string | null>>(r2.duplicate().zscore("key", "member"));
expectType<Promise<number | null>>(r3.duplicate().zscore("key", "member"));
expectType<Promise<number | null>>(
  r2.duplicate({ protocol: 3, replyMapping: "resp3" }).zscore("key", "member"),
);
expectType<Promise<string | null>>(
  r3.duplicate({ replyMapping: "legacy" }).zscore("key", "member"),
);

expectType<Promise<string>>(r2.zincrby("key", 1, "member"));
expectType<Promise<number>>(r3.zincrby("key", 1, "member"));

expectType<Promise<([longitude: string, latitude: string] | null)[]>>(
  r2.geopos("key", "member"),
);
expectType<Promise<([longitude: number, latitude: number] | null)[]>>(
  r3.geopos("key", "member"),
);

expectType<Promise<string>>(r2.hincrbyfloat("key", "field", 1.5));
expectType<Promise<string>>(r3.hincrbyfloat("key", "field", 1.5));

expectType<Promise<string>>(r2.incrbyfloat("key", 1.5));
expectType<Promise<string>>(r3.incrbyfloat("key", 1.5));

expectType<Promise<string | null>>(r2.geodist("key", "member1", "member2"));
expectType<Promise<string | null>>(r3.geodist("key", "member1", "member2"));

expectType<Promise<(string | null)[]>>(r2.zmscore("key", "member1", "member2"));
expectType<Promise<(number | null)[]>>(r3.zmscore("key", "member1", "member2"));

expectType<Promise<number>>(r2.zadd("key", 1, "member"));
expectType<Promise<number>>(r3.zadd("key", 1, "member"));
expectType<Promise<string>>(r2.zadd("key", "INCR", 1, "member"));
expectType<Promise<number>>(r3.zadd("key", "INCR", 1, "member"));
expectType<Promise<string | null>>(r2.zadd("key", "NX", "INCR", 1, "member"));
expectType<Promise<number | null>>(r3.zadd("key", "NX", "INCR", 1, "member"));
expectType<Promise<string | null>>(r2.zadd("key", "XX", "INCR", 1, "member"));
expectType<Promise<number | null>>(r3.zadd("key", "XX", "INCR", 1, "member"));

expectType<Promise<[key: string, member: string, score: string] | null>>(
  r2.bzpopmin("key", 1),
);
expectType<Promise<[key: string, member: string, score: number] | null>>(
  r3.bzpopmin("key", 1),
);
expectType<Promise<[key: string, member: string, score: string] | null>>(
  r2.bzpopmax("key", 1),
);
expectType<Promise<[key: string, member: string, score: number] | null>>(
  r3.bzpopmax("key", 1),
);

expectType<Promise<[rank: number, score: string] | null>>(
  r2.zrank("key", "member", "WITHSCORE"),
);
expectType<Promise<[rank: number, score: number] | null>>(
  r3.zrank("key", "member", "WITHSCORE"),
);
expectType<Promise<[rank: number, score: string] | null>>(
  r2.zrevrank("key", "member", "WITHSCORE"),
);
expectType<Promise<[rank: number, score: number] | null>>(
  r3.zrevrank("key", "member", "WITHSCORE"),
);

// MAP replies.
expectType<Promise<string[]>>(r2.config("GET", "maxmemory"));
expectType<Promise<Record<string, string>>>(r3.config("GET", "maxmemory"));
expectType<Promise<unknown[]>>(r2.hello());
expectType<Promise<Record<string, unknown>>>(r3.hello());
expectType<Promise<unknown[]>>(r2.memory("STATS"));
expectType<Promise<Record<string, unknown>>>(r3.memory("STATS"));
expectType<Promise<(string | number)[] | null>>(r2.vinfo("key"));
expectType<Promise<Record<string, string | number> | null>>(r3.vinfo("key"));

expectType<
  Promise<
    [value: number, increment: number] | [value: string, increment: string]
  >
>(r2.increx("key"));
expectType<Promise<[value: number, increment: number]>>(r3.increx("key"));

expectType<Promise<number>>(r2.vadd("key", "VALUES", 2, 1, 2, "member"));
expectType<Promise<boolean>>(r3.vadd("key", "VALUES", 2, 1, 2, "member"));
expectType<Promise<string[] | null>>(r2.vemb("key", "member"));
expectType<Promise<number[] | null>>(r3.vemb("key", "member"));
expectType<Promise<number>>(r2.vismember("key", "member"));
expectType<Promise<boolean>>(r3.vismember("key", "member"));
expectType<Promise<number>>(r2.vrem("key", "member"));
expectType<Promise<boolean>>(r3.vrem("key", "member"));
expectType<Promise<number>>(r2.vsetattr("key", "member", "{}"));
expectType<Promise<boolean>>(r3.vsetattr("key", "member", "{}"));

// Regeneration-dependent RespShape sites from bin/returnTypes.js.
// WITHSCORES replies are flat arrays under RESP2 and member/score pairs under RESP3.
expectType<Promise<string[]>>(r2.zrange("key", "0", "-1", "WITHSCORES"));
expectType<Promise<ScoredMember[]>>(r3.zrange("key", "0", "-1", "WITHSCORES"));

expectType<Promise<string[]>>(
  r2.zrangebyscore("key", "-inf", "+inf", "WITHSCORES"),
);
expectType<Promise<ScoredMember[]>>(
  r3.zrangebyscore("key", "-inf", "+inf", "WITHSCORES"),
);

expectType<Promise<string[]>>(r2.zrevrange("key", 0, -1, "WITHSCORES"));
expectType<Promise<ScoredMember[]>>(r3.zrevrange("key", 0, -1, "WITHSCORES"));

expectType<Promise<string[]>>(
  r2.zrevrangebyscore("key", "+inf", "-inf", "WITHSCORES"),
);
expectType<Promise<ScoredMember[]>>(
  r3.zrevrangebyscore("key", "+inf", "-inf", "WITHSCORES"),
);

expectType<Promise<string[]>>(r2.zdiff(2, "key1", "key2", "WITHSCORES"));
expectType<Promise<ScoredMember[]>>(
  r3.zdiff(2, ["key1", "key2"], "WITHSCORES"),
);

expectType<Promise<string[]>>(r2.zinter(2, "key1", "key2", "WITHSCORES"));
expectType<Promise<ScoredMember[]>>(
  r3.zinter(2, ["key1", "key2"], "WITHSCORES"),
);

expectType<Promise<string[]>>(r2.zunion(2, "key1", "key2", "WITHSCORES"));
expectType<Promise<ScoredMember[]>>(
  r3.zunion(2, ["key1", "key2"], "WITHSCORES"),
);

expectType<Promise<string[]>>(r2.zrandmember("key", 2, "WITHSCORES"));
expectType<Promise<ScoredMember[]>>(r3.zrandmember("key", 2, "WITHSCORES"));

expectType<Promise<string[]>>(r2.zpopmin("key"));
expectType<Promise<ScoredMember>>(r3.zpopmin("key"));
expectType<Promise<string[]>>(r2.zpopmax("key", 2));
expectType<Promise<ScoredMember[]>>(r3.zpopmax("key", 2));

expectType<Promise<string[]>>(r2.vsim("key", "ELE", "member"));
expectType<Promise<string[]>>(r3.vsim("key", "ELE", "member"));
expectType<Promise<string[]>>(r2.vsim("key", "ELE", "member", "WITHSCORES"));
expectType<Promise<Record<string, number>>>(
  r3.vsim("key", "ELE", "member", "WITHSCORES"),
);
expectType<Promise<string[]>>(
  r2.vsim("key", "ELE", "member", "WITHSCORES", "WITHATTRIBS"),
);
expectType<Promise<string[]>>(r2.vsim("key", "ELE", "member", "WITHATTRIBS"));
expectType<Promise<Record<string, string | null>>>(
  r3.vsim("key", "ELE", "member", "WITHATTRIBS"),
);
expectType<Promise<Record<string, VsimAttributes>>>(
  r3.vsim("key", "ELE", "member", "WITHSCORES", "WITHATTRIBS"),
);

// Callback values use the same protocol-selected reply shapes.
r2.zscore("key", "member", (err, value) => {
  expectType<Error | null | undefined>(err);
  expectType<string | null | undefined>(value);
});

r3.zscore("key", "member", (err, value) => {
  expectType<Error | null | undefined>(err);
  expectType<number | null | undefined>(value);
});

r3.config("GET", "maxmemory", (err, value) => {
  expectType<Error | null | undefined>(err);
  expectType<Record<string, string> | undefined>(value);
});

r3.zrange("key", "0", "-1", "WITHSCORES", (err, value) => {
  expectType<Error | null | undefined>(err);
  expectType<ScoredMember[] | undefined>(value);
});

// Buffer variants keep bulk fields as Buffers, while RESP3 doubles remain
// protocol-selected numbers.
expectType<Promise<Buffer | null>>(r2.zscoreBuffer("key", "member"));
expectType<Promise<number | null>>(r3.zscoreBuffer("key", "member"));

expectType<Promise<Buffer>>(r2.zincrbyBuffer("key", 1, "member"));
expectType<Promise<number>>(r3.zincrbyBuffer("key", 1, "member"));

expectType<Promise<Buffer>>(r2.hincrbyfloatBuffer("key", "field", 1.5));
expectType<Promise<Buffer>>(r3.hincrbyfloatBuffer("key", "field", 1.5));

expectType<Promise<Buffer | null>>(
  r2.geodistBuffer("key", "member1", "member2"),
);
expectType<Promise<Buffer | null>>(
  r3.geodistBuffer("key", "member1", "member2"),
);

expectType<Promise<(Buffer | null)[]>>(
  r2.zmscoreBuffer("key", "member1", "member2"),
);
expectType<Promise<(number | null)[]>>(
  r3.zmscoreBuffer("key", "member1", "member2"),
);

expectType<Promise<Buffer>>(r2.zaddBuffer("key", "INCR", 1, "member"));
expectType<Promise<number>>(r3.zaddBuffer("key", "INCR", 1, "member"));

expectType<Promise<Buffer[]>>(r2.configBuffer("GET", "maxmemory"));
expectType<Promise<Record<string, Buffer>>>(
  r3.configBuffer("GET", "maxmemory"),
);
expectType<
  Promise<
    [value: number, increment: number] | [value: Buffer, increment: Buffer]
  >
>(r2.increxBuffer("key"));
expectType<Promise<[value: number, increment: number]>>(r3.increxBuffer("key"));
expectType<Promise<(Buffer | number)[] | null>>(r2.vinfoBuffer("key"));
expectType<Promise<Record<string, Buffer | number> | null>>(
  r3.vinfoBuffer("key"),
);
expectType<Promise<Buffer[] | null>>(r2.vembBuffer("key", "member"));
expectType<Promise<number[] | null>>(r3.vembBuffer("key", "member"));

expectType<Promise<[key: Buffer, member: Buffer, score: Buffer] | null>>(
  r2.bzpopminBuffer("key", 1),
);
expectType<Promise<[key: Buffer, member: Buffer, score: number] | null>>(
  r3.bzpopminBuffer("key", 1),
);

expectType<Promise<Buffer[]>>(r2.zrangeBuffer("key", "0", "-1", "WITHSCORES"));
expectType<Promise<ScoredBufferMember[]>>(
  r3.zrangeBuffer("key", "0", "-1", "WITHSCORES"),
);

expectType<Promise<Buffer[]>>(r2.vsimBuffer("key", "ELE", "member"));
expectType<Promise<Buffer[]>>(r3.vsimBuffer("key", "ELE", "member"));
expectType<Promise<Buffer[]>>(
  r2.vsimBuffer("key", "ELE", "member", "WITHSCORES"),
);
expectType<Promise<Record<string, number>>>(
  r3.vsimBuffer("key", "ELE", "member", "WITHSCORES"),
);
expectType<Promise<Buffer[]>>(
  r2.vsimBuffer("key", "ELE", "member", "WITHSCORES", "WITHATTRIBS"),
);
expectType<Promise<Buffer[]>>(
  r2.vsimBuffer("key", "ELE", "member", "WITHATTRIBS"),
);
expectType<Promise<Record<string, Buffer | null>>>(
  r3.vsimBuffer("key", "ELE", "member", "WITHATTRIBS"),
);
expectType<Promise<Record<string, VsimBufferAttributes>>>(
  r3.vsimBuffer("key", "ELE", "member", "WITHSCORES", "WITHATTRIBS"),
);

expectType<Promise<[rank: number, score: Buffer] | null>>(
  r2.zrankBuffer("key", "member", "WITHSCORE"),
);
expectType<Promise<[rank: number, score: number] | null>>(
  r3.zrankBuffer("key", "member", "WITHSCORE"),
);

// Non-divergent commands keep the same public type under RESP3.
expectType<Promise<number>>(r2.del("key"));
expectType<Promise<number>>(r3.del("key"));
expectType<Promise<string | null>>(r2.get("key"));
expectType<Promise<string | null>>(r3.get("key"));
expectType<Promise<string>>(r2.getrange("key", 0, 1));
expectType<Promise<string>>(r3.getrange("key", 0, 1));
expectType<Promise<string[]>>(r2.lrange("key", 0, -1));
expectType<Promise<string[]>>(r3.lrange("key", 0, -1));
expectType<Promise<"OK">>(r2.set("key", "value"));
expectType<Promise<"OK">>(r3.set("key", "value"));
expectType<Promise<(string | null)[]>>(r2.mget("key1", "key2"));
expectType<Promise<(string | null)[]>>(r3.mget("key1", "key2"));
expectType<Promise<[string, string] | null>>(r2.blpop("key", 1));
expectType<Promise<[string, string] | null>>(r3.blpop("key", 1));
expectType<Promise<Record<string, string>>>(r2.hgetall("key"));
expectType<Promise<Record<string, string>>>(r3.hgetall("key"));
expectType<Promise<Record<string, Buffer>>>(r2.hgetallBuffer("key"));
expectType<Promise<Record<string, Buffer>>>(r3.hgetallBuffer("key"));
expectType<Promise<(string | null)[]>>(r2.hmget("key", "field1", "field2"));
expectType<Promise<(string | null)[]>>(r3.hmget("key", "field1", "field2"));
expectType<Promise<[cursor: string, elements: string[]]>>(r2.scan("0"));
expectType<Promise<[cursor: string, elements: string[]]>>(r3.scan("0"));
expectType<Promise<[id: string, fields: string[]][]>>(
  r2.xrange("stream", "-", "+"),
);
expectType<Promise<[id: string, fields: string[]][]>>(
  r3.xrange("stream", "-", "+"),
);

// Stream-read map replies: array-of-pairs under RESP2/legacy, stream->entries
// object under native RESP3.
type StreamReadLegacy =
  | [key: string, items: [id: string, fields: string[]][]][]
  | null;
type StreamReadResp3 = Record<string, [id: string, fields: string[]][]> | null;
type StreamReadLegacyBuffer =
  | [key: Buffer, items: [id: Buffer, fields: Buffer[]][]][]
  | null;
type StreamReadResp3Buffer = Record<
  string,
  [id: Buffer, fields: Buffer[]][]
> | null;

expectType<Promise<StreamReadLegacy>>(r2.xread("STREAMS", "stream", "0"));
expectType<Promise<StreamReadResp3>>(r3.xread("STREAMS", "stream", "0"));
expectType<Promise<StreamReadLegacyBuffer>>(
  r2.xreadBuffer("STREAMS", "stream", "0"),
);
expectType<Promise<StreamReadResp3Buffer>>(
  r3.xreadBuffer("STREAMS", "stream", "0"),
);

// xreadgroup can read the PEL by explicit ID; XDEL'd entries come back with a
// null fields payload, so the fields array is nullable per entry.
type StreamGroupReadLegacy =
  | [key: string, items: [id: string, fields: string[] | null][]][]
  | null;
type StreamGroupReadResp3 = Record<
  string,
  [id: string, fields: string[] | null][]
> | null;
type StreamGroupReadLegacyBuffer =
  | [key: Buffer, items: [id: Buffer, fields: Buffer[] | null][]][]
  | null;
type StreamGroupReadResp3Buffer = Record<
  string,
  [id: Buffer, fields: Buffer[] | null][]
> | null;

expectType<Promise<StreamGroupReadLegacy>>(
  r2.xreadgroup("GROUP", "group", "consumer", "STREAMS", "stream", ">"),
);
expectType<Promise<StreamGroupReadResp3>>(
  r3.xreadgroup("GROUP", "group", "consumer", "STREAMS", "stream", ">"),
);
expectType<Promise<StreamGroupReadLegacyBuffer>>(
  r2.xreadgroupBuffer("GROUP", "group", "consumer", "STREAMS", "stream", ">"),
);
expectType<Promise<StreamGroupReadResp3Buffer>>(
  r3.xreadgroupBuffer("GROUP", "group", "consumer", "STREAMS", "stream", ">"),
);

// Cluster inference mirrors single-node Redis inference.
expectType<Promise<string | null>>(c2.zscore("key", "member"));
expectType<Promise<number | null>>(c3.zscore("key", "member"));
expectType<Promise<string | null>>(c2.duplicate().zscore("key", "member"));
expectType<Promise<number | null>>(c3.duplicate().zscore("key", "member"));
expectType<Promise<number | null>>(
  c2
    .duplicate([], { redisOptions: { protocol: 3, replyMapping: "resp3" } })
    .zscore("key", "member"),
);
expectType<Promise<string | null>>(
  c3
    .duplicate([], { redisOptions: { replyMapping: "legacy" } })
    .zscore("key", "member"),
);
expectType<Promise<string>>(c2.zincrby("key", 1, "member"));
expectType<Promise<number>>(c3.zincrby("key", 1, "member"));
expectType<Promise<string[]>>(c2.config("GET", "maxmemory"));
expectType<Promise<Record<string, string>>>(c3.config("GET", "maxmemory"));

// Pipeline and multi callbacks follow the client's reply mapping.
r2.pipeline().zscore("key", "member", (err, result) => {
  expectType<string | null | undefined>(result);
});
r3.pipeline().zscore("key", "member", (err, result) => {
  expectType<number | null | undefined>(result);
});
r3.multi().zscore("key", "member", (err, result) => {
  expectType<number | null | undefined>(result);
});

// Chained pipeline calls keep the mapping.
r3.pipeline()
  .set("foo", "bar")
  .zscore("key", "member", (err, result) => {
    expectType<number | null | undefined>(result);
  });

// Cluster pipelines and transactions mirror single-node inference.
c2.pipeline().zscore("key", "member", (err, result) => {
  expectType<string | null | undefined>(result);
});
c3.pipeline().zscore("key", "member", (err, result) => {
  expectType<number | null | undefined>(result);
});
c3.multi().zscore("key", "member", (err, result) => {
  expectType<number | null | undefined>(result);
});
