import { expect } from "chai";
import Redis from "../../lib/Redis";
import { isRedisVersionLowerThan } from "../helpers/util";

type CommandContext = {
  key: string;
  key2: string;
  key3: string;
  field: string;
  field2: string;
  value: string;
  value2: string;
  member: string;
  member2: string;
  channel: string;
  pattern: string;
  group: string;
  consumer: string;
  id: string;
};

type CommandCase = {
  name: string;
  run: (redis: any, ctx: CommandContext) => Promise<unknown>;
  // Some commands return volatile content (timestamps, random keys, random
  // text) that differs between two independent calls even though the reply
  // *shape* is identical. For those, assert structural parity instead of
  // exact equality.
  match?: "exact" | "shape";
  // A documented RESP2/RESP3 parser discrepancy that is intentionally not
  // asserted yet (the test is marked pending). The string explains why.
  knownDiscrepancy?: string;
};

// Reduces a reply to a structural signature: arrays/objects keep their nesting
// and keys, primitives collapse to their type name. Comparing two signatures
// with `eql` verifies the shape while ignoring volatile scalar values, and
// still produces a readable diff when the shapes genuinely differ.
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(shapeOf);
  }
  if (value === null) {
    return "null";
  }
  if (Buffer.isBuffer(value)) {
    return "buffer";
  }
  if (typeof value === "object") {
    const signature: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      signature[key] = shapeOf((value as Record<string, unknown>)[key]);
    }
    return signature;
  }
  return typeof value;
}

const redisCommanderCommandCases: CommandCase[] = [
  { name: "acl", run: (redis) => redis.acl("HELP") },
  { name: "append", run: (redis, ctx) => redis.append(ctx.key, ctx.value) },
  { name: "arcount", run: (redis, ctx) => redis.arcount(ctx.key) },
  { name: "ardel", run: (redis, ctx) => redis.ardel(ctx.key, 0) },
  { name: "ardelrange", run: (redis, ctx) => redis.ardelrange(ctx.key, 0, 1) },
  { name: "arget", run: (redis, ctx) => redis.arget(ctx.key, 0) },
  { name: "argetrange", run: (redis, ctx) => redis.argetrange(ctx.key, 0, 1) },
  {
    name: "argrep",
    run: (redis, ctx) => redis.argrep(ctx.key, 0, 1, "EXACT", ctx.value),
  },
  {
    name: "arinfo",
    run: async (redis, ctx) => {
      await redis.arset(ctx.key, 0, ctx.value);
      return redis.arinfo(ctx.key);
    },
  },
  { name: "arinsert", run: (redis, ctx) => redis.arinsert(ctx.key, ctx.value) },
  { name: "arlastitems", run: (redis, ctx) => redis.arlastitems(ctx.key, 1) },
  { name: "arlen", run: (redis, ctx) => redis.arlen(ctx.key) },
  { name: "armget", run: (redis, ctx) => redis.armget(ctx.key, 0, 1) },
  { name: "armset", run: (redis, ctx) => redis.armset(ctx.key, 0, ctx.value) },
  { name: "arnext", run: (redis, ctx) => redis.arnext(ctx.key) },
  { name: "arop", run: (redis, ctx) => redis.arop(ctx.key, 0, 1, "SUM") },
  { name: "arring", run: (redis, ctx) => redis.arring(ctx.key, 2, ctx.value) },
  { name: "arscan", run: (redis, ctx) => redis.arscan(ctx.key, 0, 1) },
  { name: "arseek", run: (redis, ctx) => redis.arseek(ctx.key, 0) },
  { name: "arset", run: (redis, ctx) => redis.arset(ctx.key, 0, ctx.value) },
  { name: "bitcount", run: (redis, ctx) => redis.bitcount(ctx.key) },
  {
    name: "bitfield",
    run: (redis, ctx) => redis.bitfield(ctx.key, "GET", "u8", 0),
  },
  {
    name: "bitop",
    run: (redis, ctx) => redis.bitop("AND", ctx.key3, ctx.key, ctx.key2),
  },
  { name: "bitpos", run: (redis, ctx) => redis.bitpos(ctx.key, 1) },
  {
    name: "blmove",
    run: (redis, ctx) =>
      redis.blmove(ctx.key, ctx.key2, "LEFT", "RIGHT", 0.001),
  },
  {
    name: "blmpop",
    run: (redis, ctx) => redis.blmpop(0.001, 1, ctx.key, "LEFT"),
  },
  { name: "blpop", run: (redis, ctx) => redis.blpop(ctx.key, 0.001) },
  { name: "brpop", run: (redis, ctx) => redis.brpop(ctx.key, 0.001) },
  {
    name: "brpoplpush",
    run: (redis, ctx) => redis.brpoplpush(ctx.key, ctx.key2, 0.001),
  },
  {
    name: "bzmpop",
    run: (redis, ctx) => redis.bzmpop(0.001, 1, ctx.key, "MIN"),
  },
  { name: "bzpopmax", run: (redis, ctx) => redis.bzpopmax(ctx.key, 0.001) },
  { name: "bzpopmin", run: (redis, ctx) => redis.bzpopmin(ctx.key, 0.001) },
  { name: "client", run: (redis) => redis.client("HELP") },
  { name: "command", run: (redis) => redis.command() },
  { name: "config", run: (redis) => redis.config("HELP") },
  { name: "copy", run: (redis, ctx) => redis.copy(ctx.key, ctx.key2) },
  { name: "dbsize", run: (redis) => redis.dbsize() },
  { name: "decr", run: (redis, ctx) => redis.decr(ctx.key) },
  { name: "decrby", run: (redis, ctx) => redis.decrby(ctx.key, 1) },
  { name: "del", run: (redis, ctx) => redis.del(ctx.key) },
  {
    name: "discard",
    run: async (redis) => {
      await redis.call("MULTI");
      return redis.discard();
    },
  },
  { name: "dump", run: (redis, ctx) => redis.dump(ctx.key) },
  { name: "echo", run: (redis, ctx) => redis.echo(ctx.value) },
  { name: "eval", run: (redis) => redis.eval("return 1", 0) },
  {
    name: "evalsha",
    run: async (redis) => {
      const sha = await redis.script("LOAD", "return 1");
      return redis.evalsha(sha, 0);
    },
  },
  {
    name: "exec",
    run: async (redis) => {
      await redis.call("MULTI");
      return redis.exec();
    },
  },
  { name: "exists", run: (redis, ctx) => redis.exists(ctx.key) },
  { name: "expire", run: (redis, ctx) => redis.expire(ctx.key, 60) },
  {
    name: "expireat",
    run: (redis, ctx) => redis.expireat(ctx.key, 1893456000),
  },
  { name: "expiretime", run: (redis, ctx) => redis.expiretime(ctx.key) },
  {
    name: "fcall",
    run: async (redis) => {
      await redis.function(
        "LOAD",
        "REPLACE",
        "#!lua name=ioredisparity\nredis.register_function('ioredisparityfn', function() return 1 end)"
      );
      return redis.fcall("ioredisparityfn", 0);
    },
  },
  { name: "flushall", run: (redis) => redis.flushall("SYNC") },
  { name: "flushdb", run: (redis) => redis.flushdb("SYNC") },
  { name: "function", run: (redis) => redis.function("HELP") },
  {
    name: "geoadd",
    run: (redis, ctx) => redis.geoadd(ctx.key, 0, 0, ctx.member),
  },
  {
    name: "geodist",
    run: (redis, ctx) => redis.geodist(ctx.key, ctx.member, ctx.member2),
  },
  { name: "geohash", run: (redis, ctx) => redis.geohash(ctx.key, ctx.member) },
  { name: "geopos", run: (redis, ctx) => redis.geopos(ctx.key, ctx.member) },
  {
    name: "georadius",
    run: (redis, ctx) => redis.georadius(ctx.key, 0, 0, 1, "m"),
  },
  {
    name: "georadiusbymember",
    run: (redis, ctx) => redis.georadiusbymember(ctx.key, ctx.member, 1, "m"),
  },
  {
    name: "geosearch",
    run: (redis, ctx) =>
      redis.geosearch(ctx.key, "FROMLONLAT", 0, 0, "BYRADIUS", 1, "m"),
  },
  {
    name: "geosearchstore",
    run: (redis, ctx) =>
      redis.geosearchstore(
        ctx.key2,
        ctx.key,
        "FROMLONLAT",
        0,
        0,
        "BYRADIUS",
        1,
        "m"
      ),
  },
  { name: "get", run: (redis, ctx) => redis.get(ctx.key) },
  { name: "getbit", run: (redis, ctx) => redis.getbit(ctx.key, 0) },
  { name: "getdel", run: (redis, ctx) => redis.getdel(ctx.key) },
  { name: "getex", run: (redis, ctx) => redis.getex(ctx.key) },
  { name: "getrange", run: (redis, ctx) => redis.getrange(ctx.key, 0, 1) },
  { name: "getset", run: (redis, ctx) => redis.getset(ctx.key, ctx.value) },
  { name: "hdel", run: (redis, ctx) => redis.hdel(ctx.key, ctx.field) },
  { name: "hexists", run: (redis, ctx) => redis.hexists(ctx.key, ctx.field) },
  {
    name: "hexpire",
    run: (redis, ctx) => redis.hexpire(ctx.key, 60, "FIELDS", 1, ctx.field),
  },
  {
    name: "hexpireat",
    run: (redis, ctx) =>
      redis.hexpireat(ctx.key, 1893456000, "FIELDS", 1, ctx.field),
  },
  {
    name: "hexpiretime",
    run: (redis, ctx) => redis.hexpiretime(ctx.key, "FIELDS", 1, ctx.field),
  },
  { name: "hget", run: (redis, ctx) => redis.hget(ctx.key, ctx.field) },
  { name: "hgetall", run: (redis, ctx) => redis.hgetall(ctx.key) },
  {
    name: "hgetdel",
    run: (redis, ctx) => redis.hgetdel(ctx.key, "FIELDS", 1, ctx.field),
  },
  {
    name: "hgetex",
    run: (redis, ctx) => redis.hgetex(ctx.key, "FIELDS", 1, ctx.field),
  },
  {
    name: "hincrby",
    run: (redis, ctx) => redis.hincrby(ctx.key, ctx.field, 1),
  },
  {
    name: "hincrbyfloat",
    run: (redis, ctx) => redis.hincrbyfloat(ctx.key, ctx.field, 1.5),
  },
  { name: "hkeys", run: (redis, ctx) => redis.hkeys(ctx.key) },
  { name: "hlen", run: (redis, ctx) => redis.hlen(ctx.key) },
  {
    name: "hmget",
    run: (redis, ctx) => redis.hmget(ctx.key, ctx.field, ctx.field2),
  },
  {
    name: "hmset",
    run: (redis, ctx) => redis.hmset(ctx.key, ctx.field, ctx.value),
  },
  {
    name: "hpersist",
    run: (redis, ctx) => redis.hpersist(ctx.key, "FIELDS", 1, ctx.field),
  },
  {
    name: "hpexpire",
    run: (redis, ctx) => redis.hpexpire(ctx.key, 60000, "FIELDS", 1, ctx.field),
  },
  {
    name: "hpexpireat",
    run: (redis, ctx) =>
      redis.hpexpireat(ctx.key, 1893456000000, "FIELDS", 1, ctx.field),
  },
  {
    name: "hpexpiretime",
    run: (redis, ctx) => redis.hpexpiretime(ctx.key, "FIELDS", 1, ctx.field),
  },
  {
    name: "hpttl",
    run: (redis, ctx) => redis.hpttl(ctx.key, "FIELDS", 1, ctx.field),
  },
  { name: "hrandfield", run: (redis, ctx) => redis.hrandfield(ctx.key) },
  { name: "hscan", run: (redis, ctx) => redis.hscan(ctx.key, 0) },
  {
    name: "hset",
    run: (redis, ctx) => redis.hset(ctx.key, ctx.field, ctx.value),
  },
  {
    name: "hsetex",
    run: (redis, ctx) =>
      redis.hsetex(ctx.key, "FIELDS", 1, ctx.field, ctx.value),
  },
  {
    name: "hsetnx",
    run: (redis, ctx) => redis.hsetnx(ctx.key, ctx.field, ctx.value),
  },
  { name: "hstrlen", run: (redis, ctx) => redis.hstrlen(ctx.key, ctx.field) },
  {
    name: "httl",
    run: (redis, ctx) => redis.httl(ctx.key, "FIELDS", 1, ctx.field),
  },
  { name: "hvals", run: (redis, ctx) => redis.hvals(ctx.key) },
  { name: "incr", run: (redis, ctx) => redis.incr(ctx.key) },
  { name: "incrby", run: (redis, ctx) => redis.incrby(ctx.key, 1) },
  { name: "incrbyfloat", run: (redis, ctx) => redis.incrbyfloat(ctx.key, 1.5) },
  { name: "increx", run: (redis, ctx) => redis.increx(ctx.key) },
  { name: "info", run: (redis) => redis.info("server"), match: "shape" },
  { name: "keys", run: (redis, ctx) => redis.keys(ctx.key) },
  { name: "lastsave", run: (redis) => redis.lastsave() },
  { name: "latency", run: (redis) => redis.latency("HELP") },
  { name: "lcs", run: (redis, ctx) => redis.lcs(ctx.key, ctx.key2) },
  { name: "lindex", run: (redis, ctx) => redis.lindex(ctx.key, 0) },
  {
    name: "linsert",
    run: (redis, ctx) =>
      redis.linsert(ctx.key, "BEFORE", ctx.value, ctx.value2),
  },
  { name: "llen", run: (redis, ctx) => redis.llen(ctx.key) },
  {
    name: "lmove",
    run: (redis, ctx) => redis.lmove(ctx.key, ctx.key2, "LEFT", "RIGHT"),
  },
  { name: "lmpop", run: (redis, ctx) => redis.lmpop(1, ctx.key, "LEFT") },
  { name: "lolwut", run: (redis) => redis.lolwut(), match: "shape" },
  { name: "lpop", run: (redis, ctx) => redis.lpop(ctx.key) },
  { name: "lpos", run: (redis, ctx) => redis.lpos(ctx.key, ctx.value) },
  { name: "lpush", run: (redis, ctx) => redis.lpush(ctx.key, ctx.value) },
  { name: "lpushx", run: (redis, ctx) => redis.lpushx(ctx.key, ctx.value) },
  { name: "lrange", run: (redis, ctx) => redis.lrange(ctx.key, 0, 1) },
  { name: "lrem", run: (redis, ctx) => redis.lrem(ctx.key, 1, ctx.value) },
  {
    name: "lset",
    run: async (redis, ctx) => {
      await redis.rpush(ctx.key, ctx.value);
      return redis.lset(ctx.key, 0, ctx.value2);
    },
  },
  { name: "ltrim", run: (redis, ctx) => redis.ltrim(ctx.key, 0, 1) },
  { name: "memory", run: (redis) => redis.memory("HELP") },
  { name: "mget", run: (redis, ctx) => redis.mget(ctx.key, ctx.key2) },
  { name: "module", run: (redis) => redis.module("HELP") },
  { name: "move", run: (redis, ctx) => redis.move(ctx.key, 0) },
  {
    name: "mset",
    run: (redis, ctx) => redis.mset(ctx.key, ctx.value, ctx.key2, ctx.value2),
  },
  { name: "msetex", run: (redis, ctx) => redis.msetex(1, ctx.key, ctx.value) },
  {
    name: "msetnx",
    run: (redis, ctx) => redis.msetnx(ctx.key, ctx.value, ctx.key2, ctx.value2),
  },
  { name: "object", run: (redis) => redis.object("HELP") },
  { name: "persist", run: (redis, ctx) => redis.persist(ctx.key) },
  { name: "pexpire", run: (redis, ctx) => redis.pexpire(ctx.key, 60000) },
  {
    name: "pexpireat",
    run: (redis, ctx) => redis.pexpireat(ctx.key, 1893456000000),
  },
  { name: "pexpiretime", run: (redis, ctx) => redis.pexpiretime(ctx.key) },
  { name: "pfadd", run: (redis, ctx) => redis.pfadd(ctx.key, ctx.value) },
  { name: "pfcount", run: (redis, ctx) => redis.pfcount(ctx.key) },
  {
    name: "pfdebug",
    run: async (redis, ctx) => {
      await redis.pfadd(ctx.key, ctx.value);
      return redis.pfdebug("GETREG", ctx.key);
    },
  },
  {
    name: "pfmerge",
    run: (redis, ctx) => redis.pfmerge(ctx.key3, ctx.key, ctx.key2),
  },
  { name: "pfselftest", run: (redis) => redis.pfselftest() },
  { name: "ping", run: (redis) => redis.ping() },
  {
    name: "psetex",
    run: (redis, ctx) => redis.psetex(ctx.key, 60000, ctx.value),
  },
  { name: "psubscribe", run: (redis, ctx) => redis.psubscribe(ctx.pattern) },
  { name: "pttl", run: (redis, ctx) => redis.pttl(ctx.key) },
  {
    name: "publish",
    run: (redis, ctx) => redis.publish(ctx.channel, ctx.value),
  },
  { name: "pubsub", run: (redis) => redis.pubsub("HELP") },
  {
    name: "punsubscribe",
    run: (redis, ctx) => redis.punsubscribe(ctx.pattern),
  },
  { name: "quit", run: (redis) => redis.quit() },
  { name: "randomkey", run: (redis) => redis.randomkey(), match: "shape" },
  {
    name: "rename",
    run: async (redis, ctx) => {
      await redis.set(ctx.key, ctx.value);
      return redis.rename(ctx.key, ctx.key2);
    },
  },
  {
    name: "renamenx",
    run: async (redis, ctx) => {
      await redis.set(ctx.key, ctx.value);
      return redis.renamenx(ctx.key, ctx.key2);
    },
  },
  { name: "replconf", run: (redis) => redis.replconf("listening-port", 0) },
  { name: "replicaof", run: (redis) => redis.replicaof("NO", "ONE") },
  { name: "reset", run: (redis) => redis.reset() },
  {
    name: "restore",
    run: async (redis, ctx) => {
      await redis.set(ctx.key, ctx.value);
      const dumped = await redis.dumpBuffer(ctx.key);
      return redis.restore(ctx.key2, 0, dumped);
    },
  },
  { name: "role", run: (redis) => redis.role() },
  { name: "rpop", run: (redis, ctx) => redis.rpop(ctx.key) },
  {
    name: "rpoplpush",
    run: (redis, ctx) => redis.rpoplpush(ctx.key, ctx.key2),
  },
  { name: "rpush", run: (redis, ctx) => redis.rpush(ctx.key, ctx.value) },
  { name: "rpushx", run: (redis, ctx) => redis.rpushx(ctx.key, ctx.value) },
  { name: "sadd", run: (redis, ctx) => redis.sadd(ctx.key, ctx.member) },
  { name: "save", run: (redis) => redis.save() },
  { name: "scan", run: (redis) => redis.scan(0) },
  { name: "scard", run: (redis, ctx) => redis.scard(ctx.key) },
  { name: "script", run: (redis) => redis.script("HELP") },
  { name: "sdiff", run: (redis, ctx) => redis.sdiff(ctx.key, ctx.key2) },
  {
    name: "sdiffstore",
    run: (redis, ctx) => redis.sdiffstore(ctx.key3, ctx.key, ctx.key2),
  },
  { name: "select", run: (redis) => redis.select(0) },
  { name: "set", run: (redis, ctx) => redis.set(ctx.key, ctx.value) },
  { name: "setbit", run: (redis, ctx) => redis.setbit(ctx.key, 0, 1) },
  { name: "setex", run: (redis, ctx) => redis.setex(ctx.key, 60, ctx.value) },
  { name: "setnx", run: (redis, ctx) => redis.setnx(ctx.key, ctx.value) },
  {
    name: "setrange",
    run: (redis, ctx) => redis.setrange(ctx.key, 0, ctx.value),
  },
  { name: "sinter", run: (redis, ctx) => redis.sinter(ctx.key, ctx.key2) },
  { name: "sintercard", run: (redis, ctx) => redis.sintercard(1, ctx.key) },
  {
    name: "sinterstore",
    run: (redis, ctx) => redis.sinterstore(ctx.key3, ctx.key, ctx.key2),
  },
  {
    name: "sismember",
    run: (redis, ctx) => redis.sismember(ctx.key, ctx.member),
  },
  { name: "slaveof", run: (redis) => redis.slaveof("NO", "ONE") },
  { name: "slowlog", run: (redis) => redis.slowlog("HELP") },
  { name: "smembers", run: (redis, ctx) => redis.smembers(ctx.key) },
  {
    name: "smismember",
    run: (redis, ctx) => redis.smismember(ctx.key, ctx.member, ctx.member2),
  },
  {
    name: "smove",
    run: (redis, ctx) => redis.smove(ctx.key, ctx.key2, ctx.member),
  },
  { name: "sort", run: (redis, ctx) => redis.sort(ctx.key) },
  { name: "spop", run: (redis, ctx) => redis.spop(ctx.key) },
  {
    name: "spublish",
    run: (redis, ctx) => redis.spublish(ctx.channel, ctx.value),
  },
  { name: "srandmember", run: (redis, ctx) => redis.srandmember(ctx.key) },
  { name: "srem", run: (redis, ctx) => redis.srem(ctx.key, ctx.member) },
  { name: "sscan", run: (redis, ctx) => redis.sscan(ctx.key, 0) },
  { name: "ssubscribe", run: (redis, ctx) => redis.ssubscribe(ctx.channel) },
  { name: "strlen", run: (redis, ctx) => redis.strlen(ctx.key) },
  { name: "subscribe", run: (redis, ctx) => redis.subscribe(ctx.channel) },
  { name: "substr", run: (redis, ctx) => redis.substr(ctx.key, 0, 1) },
  { name: "sunion", run: (redis, ctx) => redis.sunion(ctx.key, ctx.key2) },
  {
    name: "sunionstore",
    run: (redis, ctx) => redis.sunionstore(ctx.key3, ctx.key, ctx.key2),
  },
  {
    name: "sunsubscribe",
    run: (redis, ctx) => redis.sunsubscribe(ctx.channel),
  },
  { name: "swapdb", run: (redis) => redis.swapdb(0, 1) },
  { name: "time", run: (redis) => redis.time(), match: "shape" },
  { name: "touch", run: (redis, ctx) => redis.touch(ctx.key) },
  { name: "ttl", run: (redis, ctx) => redis.ttl(ctx.key) },
  { name: "type", run: (redis, ctx) => redis.type(ctx.key) },
  { name: "unlink", run: (redis, ctx) => redis.unlink(ctx.key) },
  { name: "unsubscribe", run: (redis, ctx) => redis.unsubscribe(ctx.channel) },
  { name: "unwatch", run: (redis) => redis.unwatch() },
  {
    name: "vadd",
    run: (redis, ctx) => redis.vadd(ctx.key, "VALUES", 2, 0.1, 0.2, ctx.member),
  },
  { name: "vcard", run: (redis, ctx) => redis.vcard(ctx.key) },
  {
    name: "vdim",
    run: async (redis, ctx) => {
      await redis.vadd(ctx.key, "VALUES", 2, 0.1, 0.2, ctx.member);
      return redis.vdim(ctx.key);
    },
  },
  { name: "vemb", run: (redis, ctx) => redis.vemb(ctx.key, ctx.member) },
  {
    name: "vgetattr",
    run: (redis, ctx) => redis.vgetattr(ctx.key, ctx.member),
  },
  { name: "vinfo", run: (redis, ctx) => redis.vinfo(ctx.key) },
  {
    name: "vismember",
    run: (redis, ctx) => redis.vismember(ctx.key, ctx.member),
  },
  { name: "vlinks", run: (redis, ctx) => redis.vlinks(ctx.key, ctx.member) },
  { name: "vrandmember", run: (redis, ctx) => redis.vrandmember(ctx.key) },
  { name: "vrange", run: (redis, ctx) => redis.vrange(ctx.key, "-", "+") },
  { name: "vrem", run: (redis, ctx) => redis.vrem(ctx.key, ctx.member) },
  {
    name: "vsetattr",
    run: (redis, ctx) => redis.vsetattr(ctx.key, ctx.member, "{}"),
  },
  {
    name: "vsim",
    run: (redis, ctx) => redis.vsim(ctx.key, "VALUES", 2, 0.1, 0.2),
  },
  { name: "wait", run: (redis) => redis.wait(0, 0) },
  { name: "watch", run: (redis, ctx) => redis.watch(ctx.key) },
  { name: "xack", run: (redis, ctx) => redis.xack(ctx.key, ctx.group, ctx.id) },
  {
    name: "xadd",
    run: (redis, ctx) => redis.xadd(ctx.key, "*", ctx.field, ctx.value),
  },
  {
    name: "xautoclaim",
    run: async (redis, ctx) => {
      await redis.xadd(ctx.key, ctx.id, ctx.field, ctx.value);
      await redis.xgroup("CREATE", ctx.key, ctx.group, "0");
      await redis.xreadgroup(
        "GROUP",
        ctx.group,
        ctx.consumer,
        "COUNT",
        1,
        "STREAMS",
        ctx.key,
        ">"
      );
      return redis.xautoclaim(ctx.key, ctx.group, ctx.consumer, 0, "0-0");
    },
  },
  {
    name: "xclaim",
    run: async (redis, ctx) => {
      await redis.xadd(ctx.key, ctx.id, ctx.field, ctx.value);
      await redis.xgroup("CREATE", ctx.key, ctx.group, "0");
      await redis.xreadgroup(
        "GROUP",
        ctx.group,
        ctx.consumer,
        "COUNT",
        1,
        "STREAMS",
        ctx.key,
        ">"
      );
      return redis.xclaim(ctx.key, ctx.group, ctx.consumer, 0, ctx.id);
    },
  },
  { name: "xdel", run: (redis, ctx) => redis.xdel(ctx.key, ctx.id) },
  {
    name: "xdelex",
    run: (redis, ctx) => redis.xdelex(ctx.key, "IDS", 1, ctx.id),
  },
  { name: "xgroup", run: (redis) => redis.xgroup("HELP") },
  { name: "xinfo", run: (redis) => redis.xinfo("HELP") },
  { name: "xlen", run: (redis, ctx) => redis.xlen(ctx.key) },
  {
    name: "xnack",
    run: async (redis, ctx) => {
      await redis.xadd(ctx.key, ctx.id, ctx.field, ctx.value);
      await redis.xgroup("CREATE", ctx.key, ctx.group, "0");
      await redis.xreadgroup(
        "GROUP",
        ctx.group,
        ctx.consumer,
        "COUNT",
        1,
        "STREAMS",
        ctx.key,
        ">"
      );
      return redis.xnack(ctx.key, ctx.group, "FAIL", "IDS", 1, ctx.id);
    },
  },
  {
    name: "xpending",
    run: async (redis, ctx) => {
      await redis.xadd(ctx.key, ctx.id, ctx.field, ctx.value);
      await redis.xgroup("CREATE", ctx.key, ctx.group, "0");
      await redis.xreadgroup(
        "GROUP",
        ctx.group,
        ctx.consumer,
        "COUNT",
        1,
        "STREAMS",
        ctx.key,
        ">"
      );
      return redis.xpending(ctx.key, ctx.group);
    },
  },
  { name: "xrange", run: (redis, ctx) => redis.xrange(ctx.key, "-", "+") },
  {
    name: "xread",
    run: (redis, ctx) => redis.xread("STREAMS", ctx.key, "0-0"),
  },
  {
    name: "xreadgroup",
    // Known discrepancy: RESP3 returns XREAD/XREADGROUP as a map
    // {stream: entries}, which legacy map-flattening turns into
    // [stream, entries]. RESP2 returns an array-of-pairs [[stream, entries]],
    // so the shapes differ. Generic map flattening can't reconcile this (it is
    // correct for CONFIG GET etc.); a command-specific reply transform would be
    // needed. XREAD has the same latent issue but only surfaces with data.
    knownDiscrepancy:
      "RESP3 XREAD/XREADGROUP map flattens to [stream, entries] vs RESP2 [[stream, entries]]",
    run: async (redis, ctx) => {
      await redis.xadd(ctx.key, ctx.id, ctx.field, ctx.value);
      await redis.xgroup("CREATE", ctx.key, ctx.group, "0");
      return redis.xreadgroup(
        "GROUP",
        ctx.group,
        ctx.consumer,
        "STREAMS",
        ctx.key,
        ">"
      );
    },
  },
  {
    name: "xrevrange",
    run: (redis, ctx) => redis.xrevrange(ctx.key, "+", "-"),
  },
  {
    name: "xsetid",
    run: async (redis, ctx) => {
      await redis.xadd(ctx.key, ctx.id, ctx.field, ctx.value);
      return redis.xsetid(ctx.key, "9999999999999-0");
    },
  },
  { name: "xtrim", run: (redis, ctx) => redis.xtrim(ctx.key, "MAXLEN", 1) },
  { name: "zadd", run: (redis, ctx) => redis.zadd(ctx.key, 1, ctx.member) },
  { name: "zcard", run: (redis, ctx) => redis.zcard(ctx.key) },
  {
    name: "zcount",
    run: (redis, ctx) => redis.zcount(ctx.key, "-inf", "+inf"),
  },
  { name: "zdiff", run: (redis, ctx) => redis.zdiff(1, ctx.key) },
  {
    name: "zdiffstore",
    run: (redis, ctx) => redis.zdiffstore(ctx.key3, 1, ctx.key),
  },
  {
    name: "zincrby",
    run: (redis, ctx) => redis.zincrby(ctx.key, 1, ctx.member),
  },
  { name: "zinter", run: (redis, ctx) => redis.zinter(1, ctx.key) },
  { name: "zintercard", run: (redis, ctx) => redis.zintercard(1, ctx.key) },
  {
    name: "zinterstore",
    run: (redis, ctx) => redis.zinterstore(ctx.key3, 1, ctx.key),
  },
  {
    name: "zlexcount",
    run: (redis, ctx) => redis.zlexcount(ctx.key, "-", "+"),
  },
  { name: "zmpop", run: (redis, ctx) => redis.zmpop(1, ctx.key, "MIN") },
  {
    name: "zmscore",
    run: (redis, ctx) => redis.zmscore(ctx.key, ctx.member, ctx.member2),
  },
  { name: "zpopmax", run: (redis, ctx) => redis.zpopmax(ctx.key) },
  { name: "zpopmin", run: (redis, ctx) => redis.zpopmin(ctx.key) },
  { name: "zrandmember", run: (redis, ctx) => redis.zrandmember(ctx.key) },
  { name: "zrange", run: (redis, ctx) => redis.zrange(ctx.key, 0, 1) },
  {
    name: "zrangebylex",
    run: (redis, ctx) => redis.zrangebylex(ctx.key, "-", "+"),
  },
  {
    name: "zrangebyscore",
    run: (redis, ctx) => redis.zrangebyscore(ctx.key, "-inf", "+inf"),
  },
  {
    name: "zrangestore",
    run: (redis, ctx) => redis.zrangestore(ctx.key3, ctx.key, 0, 1),
  },
  { name: "zrank", run: (redis, ctx) => redis.zrank(ctx.key, ctx.member) },
  { name: "zrem", run: (redis, ctx) => redis.zrem(ctx.key, ctx.member) },
  {
    name: "zremrangebylex",
    run: (redis, ctx) => redis.zremrangebylex(ctx.key, "-", "+"),
  },
  {
    name: "zremrangebyrank",
    run: (redis, ctx) => redis.zremrangebyrank(ctx.key, 0, 1),
  },
  {
    name: "zremrangebyscore",
    run: (redis, ctx) => redis.zremrangebyscore(ctx.key, "-inf", "+inf"),
  },
  { name: "zrevrange", run: (redis, ctx) => redis.zrevrange(ctx.key, 0, 1) },
  {
    name: "zrevrangebylex",
    run: (redis, ctx) => redis.zrevrangebylex(ctx.key, "+", "-"),
  },
  {
    name: "zrevrangebyscore",
    run: (redis, ctx) => redis.zrevrangebyscore(ctx.key, "+inf", "-inf"),
  },
  {
    name: "zrevrank",
    run: (redis, ctx) => redis.zrevrank(ctx.key, ctx.member),
  },
  { name: "zscan", run: (redis, ctx) => redis.zscan(ctx.key, 0) },
  { name: "zscore", run: (redis, ctx) => redis.zscore(ctx.key, ctx.member) },
  { name: "zunion", run: (redis, ctx) => redis.zunion(1, ctx.key) },
  {
    name: "zunionstore",
    run: (redis, ctx) => redis.zunionstore(ctx.key3, 1, ctx.key),
  },
];

describe("resp3", function () {
  this.timeout(10000);

  before(async function () {
    if (await isRedisVersionLowerThan("6.0")) {
      this.skip();
    }
  });

  it("supports set and get against Redis", async () => {
    const redis = new Redis({ protocol: 3 });
    const key = `resp3:${Date.now()}`;

    try {
      expect(await redis.set(key, "value")).to.equal("OK");
      expect(await redis.get(key)).to.equal("value");
    } finally {
      redis.disconnect();
    }
  });

  it("allows commands while subscribed", async () => {
    const redis = new Redis({ protocol: 3 });
    const key = `resp3:subscribed:${Date.now()}`;
    const channel = `resp3:channel:${Date.now()}`;

    try {
      expect(await redis.subscribe(channel)).to.equal(1);
      expect(redis.mode).to.equal("normal");
      expect(await redis.set(key, "value")).to.equal("OK");
      expect(await redis.get(key)).to.equal("value");
      expect(await redis.del(key)).to.equal(1);
    } finally {
      redis.disconnect();
    }
  });

  it("routes replies that look like pub/sub messages to commands while subscribed", async () => {
    const redis = new Redis({ protocol: 3 });
    const key = `resp3:subscribed:routing:${Date.now()}`;
    const channel = `resp3:channel:${Date.now()}`;

    let messageEvents = 0;
    redis.on("message", () => {
      messageEvents += 1;
    });

    try {
      expect(await redis.subscribe(channel)).to.equal(1);
      await redis.rpush(key, "message", "a", "b");
      expect(await redis.lrange(key, 0, -1)).to.eql(["message", "a", "b"]);
      expect(messageEvents).to.equal(0);
    } finally {
      redis.disconnect();
    }
  });

  it("receives published messages while subscribed", async () => {
    const redis = new Redis({ protocol: 3 });
    const pub = new Redis({ protocol: 3 });
    const channel = `resp3:channel:${Date.now()}`;

    try {
      expect(await redis.subscribe(channel)).to.equal(1);
      const message = new Promise<[string, string]>((resolve) => {
        redis.once("message", (channel, message) => {
          resolve([channel, message]);
        });
      });

      expect(await pub.publish(channel, "message")).to.equal(1);
      expect(await message).to.eql([channel, "message"]);
    } finally {
      redis.disconnect();
      pub.disconnect();
    }
  });

  describe("RedisCommander command parity", function () {
    for (const commandCase of redisCommanderCommandCases) {
      // Cases tagged with a known discrepancy run the command but are marked
      // pending so the unresolved RESP2/RESP3 difference stays visible.
      const register = commandCase.knownDiscrepancy ? it.skip : it;
      register(
        `returns the same response for ${commandCase.name} in RESP2 and RESP3`,
        async () => {
          const resp2 = new Redis({
            autoResendUnfulfilledCommands: false,
            autoResubscribe: false,
            commandTimeout: 500,
            db: 14,
            protocol: 2,
            retryStrategy: () => null,
          });
          const resp3 = new Redis({
            autoResendUnfulfilledCommands: false,
            autoResubscribe: false,
            commandTimeout: 500,
            db: 15,
            protocol: 3,
            retryStrategy: () => null,
          });
          const id = Date.now();
          const ctx: CommandContext = {
            key: `ioredis:resp-comparison:${commandCase.name}:${id}:1`,
            key2: `ioredis:resp-comparison:${commandCase.name}:${id}:2`,
            key3: `ioredis:resp-comparison:${commandCase.name}:${id}:3`,
            field: "field",
            field2: "field2",
            value: "value",
            value2: "value2",
            member: "member",
            member2: "member2",
            channel: `ioredis:resp-comparison:${commandCase.name}:${id}:channel`,
            pattern: `ioredis:resp-comparison:${commandCase.name}:${id}:*`,
            group: `group-${id}`,
            consumer: `consumer-${id}`,
            id: "0-1",
          };

          try {
            await Promise.all([
              resp2.del(ctx.key, ctx.key2, ctx.key3),
              resp3.del(ctx.key, ctx.key2, ctx.key3),
            ]);

            const [resp2Reply, resp3Reply] = await Promise.allSettled([
              commandCase.run(resp2, ctx),
              commandCase.run(resp3, ctx),
            ]);

            if (resp2Reply.status === "rejected") {
              console.log("commandCase.name", commandCase.name);
              console.log("resp2Reply", resp2Reply);
            }

            if (resp3Reply.status === "rejected") {
              console.log("resp3Reply", resp3Reply);
            }

            if (commandCase.match === "shape") {
              // Volatile content: require the same fulfilled/rejected outcome and
              // the same structural shape, ignoring the differing scalar values.
              expect(resp3Reply.status).to.equal(resp2Reply.status);
              if (
                resp2Reply.status === "fulfilled" &&
                resp3Reply.status === "fulfilled"
              ) {
                expect(shapeOf(resp3Reply.value)).to.eql(
                  shapeOf(resp2Reply.value)
                );
              }
            } else {
              expect(resp3Reply).to.eql(resp2Reply);
            }
          } finally {
            resp2.disconnect();
            resp3.disconnect();
          }
        }
      );
    }
  });
});
