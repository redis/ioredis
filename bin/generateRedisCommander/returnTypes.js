const hasToken = (types, token) => {
  if (Array.isArray(token)) return token.some((t) => hasToken(types, t));
  return types.find((type) => type.includes(token));
};

const matchSubcommand = (types, subcommand) => {
  if (Array.isArray(subcommand))
    return subcommand.some((s) => matchSubcommand(types, s));
  return types[0].includes(subcommand);
};

module.exports = {
  multi: "ChainableCommander",
  get: "string | null",
  set: (types) => {
    if (hasToken(types, "GET")) return "string | null";
    if (hasToken(types, ["NX", "XX"])) return "'OK' | null";
    return "'OK'";
  },
  ping: (types) => {
    return types.length ? "string" : "'PONG'";
  },
  latency: (types) => {
    if (matchSubcommand(types, ["HELP", "LATEST", "HISTORY"])) {
      return "unknown[]";
    }
    if (matchSubcommand(types, "RESET")) {
      return "number";
    }
    if (matchSubcommand(types, ["DOCTOR", "GRAPH"])) {
      return "string";
    }
  },
  append: "number",
  asking: "'OK'",
  auth: "'OK'",
  bgrewriteaof: "string",
  bgsave: "'OK'",
  bitcount: "number",
  bitfield_ro: "unknown[]",
  bitop: "number",
  bitpos: "number",
  blpop: "[string, string] | null",
  brpop: "[string, string] | null",
  brpoplpush: "string | null",
  blmove: "string | null",
  lmpop: "unknown[] | null",
  blmpop: "unknown[] | null",
  bzpopmin: "unknown[] | null",
  bzpopmax: "unknown[] | null",
  command: "unknown[]",
  copy: "number",
  dbsize: "number",
  decr: "number",
  decrby: "number",
  del: "number",
  discard: "'OK'",
  dump: "string",
  echo: "string",
  exec: "[error: Error, result: unknown][] | null",
  exists: "number",
  expire: "number",
  expireat: "number",
  expiretime: "number",
  failover: "'OK'",
  flushall: "'OK'",
  flushdb: "'OK'",
  geoadd: "number",
  geohash: "string[]",
  geopos: "unknown[] | null",
  geodist: "string | null",
  georadius: "unknown[]",
  geosearch: "unknown[]",
  geosearchstore: "number",
  getbit: "number",
  getdel: "string | null",
  getex: "string | null",
  getrange: "string",
  getset: "string | null",
  hdel: "number",
  hello: "unknown[]",
  hexists: "number",
  hget: "string | null",
  hincrby: "number",
  hincrbyfloat: "string",
  hkeys: "string[]",
  hlen: "number",
  hmget: "(string | null)[]",
  hmset: "'OK'",
  hset: "number",
  hsetnx: "number",
  memory: (types) => {
    if (matchSubcommand(types, "MALLOC-STATS")) return "string";
    if (matchSubcommand(types, "PURGE")) return '"OK"';
    if (matchSubcommand(types, "HELP")) return "unknown[]";
    if (matchSubcommand(types, "STATS")) return "unknown[]";
    if (matchSubcommand(types, "USAGE")) return "number | null";
    if (matchSubcommand(types, "DOCTOR")) return "string";
  },
  hrandfield: "string | unknown[] | null",
  hstrlen: "number",
  hvals: "string[]",
  incr: "number",
  incrby: "number",
  incrbyfloat: "string",
  info: "string",
  lolwut: "string",
  keys: "string[]",
  lastsave: "number",
  lindex: "string | null",
  linsert: "number",
  llen: "number",
  lpop: (types) => {
    return types.includes("number") ? "string[] | null" : "string | null";
  },
  lpos: (types) => {
    return hasToken(types, "COUNT") ? "number[]" : "number | null";
  },
  lpush: "number",
  lpushx: "number",
  lrange: "string[]",
  lrem: "number",
  lset: "'OK'",
  ltrim: "'OK'",
  mget: "(string | null)[]",
  migrate: "'OK'",
  move: "number",
  mset: "'OK'",
  msetnx: "number",
  persist: "number",
  pexpire: "number",
  pexpireat: "number",
  pexpiretime: "number",
  pfadd: "number",
  pfcount: "number",
  pfmerge: "'OK'",
  pubsub: "unknown[]",
  pttl: "number",
  publish: "number",
  quit: "'OK'",
  randomkey: "string | null",
  readonly: "'OK'",
  readwrite: "'OK'",
  rename: "'OK'",
  renamenx: "number",
  reset: "'OK'",
  restore: "'OK'",
  role: "unknown[]",
  rpop: (types) => {
    return types.includes("number") ? "string[] | null" : "string | null";
  },
  rpoplpush: "string",
  lmove: "string",
  rpush: "number",
  rpushx: "number",
  sadd: "number",
  save: "'OK'",
  scard: "number",
  sdiff: "string[]",
  sdiffstore: "number",
  select: "'OK'",
  setbit: "number",
  setex: "'OK'",
  setnx: "number",
  setrange: "number",
  shutdown: "'OK'",
  sinter: "string[]",
  sintercard: "number",
  sinterstore: "number",
  sismember: "number",
  smismember: "unknown[]",
  slaveof: "'OK'",
  replicaof: "'OK'",
  smembers: "string[]",
  smove: "number",
  sort: "number" | "unknown[]",
  sortRo: "unknown[]",
  spop: (types) => (types.length > 1 ? "string[]" : "string | null"),
  srandmember: "string | unknown[] | null",
  srem: "number",
  strlen: "number",
  sunion: "string[]",
  sunionstore: "number",
  swapdb: "'OK'",
  time: "number[]",
  touch: "number",
  ttl: "number",
  type: "string",
  unlink: "number",
  unwatch: "'OK'",
  wait: "number",
  watch: "'OK'",
  zadd: (types) => {
    if (types.find((type) => type.includes("INCR"))) {
      if (types.find((type) => type.includes("XX") || type.includes("NX"))) {
        return "string | null";
      }
      return "string";
    }
    return "number";
  },
  zcard: "number",
  zcount: "number",
  zdiff: "string[]",
  zdiffstore: "number",
  zincrby: "string",
  zinter: "string[]",
  zintercard: "number",
  zinterstore: "number",
  zlexcount: "number",
  zpopmax: "string[]",
  zpopmin: "string[]",
  zrandmember: (types) => {
    return types.includes("number") ? "string | null" : "string[]";
  },
  zrangestore: "number",
  zrange: "string[]",
  zrangebylex: "string[]",
  zrevrangebylex: "string[]",
  zrangebyscore: "string[]",
  zrank: "number | null",
  zrem: "number",
  zremrangebylex: "number",
  zremrangebyrank: "number",
  zremrangebyscore: "number",
  zrevrange: "string[]",
  zrevrangebyscore: "string[]",
  zrevrank: "number | null",
  zscore: "string",
  zunion: "unknown[]",
  zmscore: "unknown[] | null",
  zunionstore: "number",
  scan: "[cursor: string, elements: string[]]",
  sscan: "[cursor: string, elements: string[]]",
  hscan: "[cursor: string, elements: string[]]",
  zscan: "[cursor: string, elements: string[]]",
  xadd: "string | null",
  xtrim: "number",
  xdel: "number",
  xrange: "[id: string, fields: string[]][]",
  xrevrange: "[id: string, fields: string[]][]",
  xlen: "number",
  xread: (types) => {
    if (types.find((type) => type.includes("BLOCK"))) {
      return "unknown[] | null";
    }
    return "unknown[]";
  },
  xreadgroup: "unknown[]",
  xack: "number",
  xclaim: "unknown[]",
  xautoclaim: "unknown[]",
  xpending: "unknown[]",
};
