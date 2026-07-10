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
  function: (types) => {
    if (
      matchSubcommand(types, [
        "LOAD",
        "DELETE",
        "DUMP",
        "FLUSH",
        "KILL",
        "RESTORE",
      ])
    ) {
      return "string";
    }
    if (matchSubcommand(types, ["LIST"])) {
      return "unknown[]";
    }
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
  cluster: (types) => {
    if (matchSubcommand(types, "SLOTS")) {
      return "[startSlotRange: number, endSlotRange: number, ...nodes: [host: string, port: number, nodeId: string, info: unknown[]][]][]";
    }
    if (
      matchSubcommand(types, [
        "ADDSLOTS",
        "ADDSLOTSRANGE",
        "DELSLOTS",
        "DELSLOTSRANGE",
        "FAILOVER",
        "FLUSHSLOTS",
        "FORGET",
        "MEET",
        "REPLICATE",
        "RESET",
        "SAVECONFIG",
        "SET-CONFIG-EPOCH",
        "SETSLOT",
      ])
    ) {
      return "'OK'";
    }
    if (matchSubcommand(types, "BUMPEPOCH")) {
      return "'BUMPED' | 'STILL'";
    }
    if (
      matchSubcommand(types, [
        "COUNT-FAILURE-REPORTS",
        "COUNTKEYSINSLOT",
        "KEYSLOT",
      ])
    ) {
      return "number";
    }
    if (matchSubcommand(types, "GETKEYSINSLOT")) {
      return "string[]";
    }
    if (matchSubcommand(types, ["INFO", "MYID"])) {
      return "string";
    }
    if (matchSubcommand(types, "LINKS")) {
      return "unknown[]";
    }
  },
  append: "number",
  arcount: "number",
  ardel: "number",
  ardelrange: "number",
  arget: "string | null",
  argetrange: "(string | null)[]",
  argrep: (types) => {
    return hasToken(types, "WITHVALUES")
      ? "Array<[index: number, value: string]>"
      : "number[]";
  },
  arinfo: "(string | number)[]",
  arinsert: "number",
  arlastitems: "(string | null)[]",
  arlen: "number",
  armget: "(string | null)[]",
  armset: "number",
  arnext: "number | null",
  arop: (types) => {
    if (hasToken(types, ["SUM", "MIN", "MAX"])) return "string | null";
    if (hasToken(types, ["AND", "OR", "XOR"])) return "number | null";
    if (hasToken(types, ["MATCH", "USED"])) return "number";
  },
  arring: "number",
  arscan: "Array<[index: number, value: string]>",
  arseek: "number",
  arset: "number",
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
  lmpop: "[key: string, members: string[]] | null",
  blmpop: "[key: string, members: string[]] | null",
  bzpopmin: {
    resp2: "[key: string, member: string, score: string] | null",
    resp3: "[key: string, member: string, score: Resp3Double<string>] | null",
  },
  bzpopmax: {
    resp2: "[key: string, member: string, score: string] | null",
    resp3: "[key: string, member: string, score: Resp3Double<string>] | null",
  },
  command: "unknown[]",
  config: (types) => {
    // CONFIG GET is a MAP reply: flat [k, v, ...] under RESP2, object under RESP3.
    // Other subcommands (SET/REWRITE/RESETSTAT/HELP) fall through to the default.
    if (matchSubcommand(types, "GET"))
      return { resp2: "string[]", resp3: "Resp3Map<string>" };
  },
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
  geopos: {
    resp2: "([longitude: string, latitude: string] | null)[]",
    resp3:
      "([longitude: Resp3Double<string>, latitude: Resp3Double<string>] | null)[]",
  },
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
  hello: { resp2: "unknown[]", resp3: "Resp3Map<unknown>" },
  hexists: "number",
  hexpire: "number[]",
  hexpireat: "number[]",
  hexpiretime: "number[]",
  hpexpire: "number[]",
  hget: "string | null",
  hgetall: "[field: string, value: string][]",
  hgetdel: "(string | null)[]",
  hgetex: "(string | null)[]",
  hincrby: "number",
  hincrbyfloat: "string",
  hkeys: "string[]",
  hlen: "number",
  hmget: "(string | null)[]",
  hmset: "'OK'",
  hpersist: "number[]",
  hpexpireat: "number[]",
  hpexpiretime: "number[]",
  hpttl: "number[]",
  hset: "number",
  hsetex: "number",
  hsetnx: "number",
  httl: "number[]",
  acl: (types) => {
    if (matchSubcommand(types, "SAVE")) return '"OK"';
    if (matchSubcommand(types, "DELUSER")) return "number";
    if (matchSubcommand(types, "WHOAMI")) return "string";
    if (matchSubcommand(types, "DRYRUN")) return "string";
    if (matchSubcommand(types, "GENPASS")) return "string";
    if (matchSubcommand(types, "GETUSER")) return "string[] | null";
    if (matchSubcommand(types, "LIST")) return "string[]";
    if (matchSubcommand(types, "USERS")) return "string[]";
    if (matchSubcommand(types, "LOAD")) return '"OK"';
    if (matchSubcommand(types, "SETUSER")) return '"OK"';
  },
  client: (types) => {
    if (matchSubcommand(types, "CACHING")) return '"OK"';
    if (matchSubcommand(types, "PAUSE")) return '"OK"';
    if (matchSubcommand(types, "UNPAUSE")) return '"OK"';
    if (matchSubcommand(types, "SETNAME")) return '"OK"';
    if (matchSubcommand(types, "GETNAME")) return "string | null";
    if (matchSubcommand(types, "GETREDIR")) return "number";
    if (matchSubcommand(types, "INFO")) return "string";
    if (matchSubcommand(types, "ID")) return "number";
  },
  memory: (types) => {
    if (matchSubcommand(types, "MALLOC-STATS")) return "string";
    if (matchSubcommand(types, "PURGE")) return '"OK"';
    if (matchSubcommand(types, "HELP")) return "unknown[]";
    if (matchSubcommand(types, "STATS"))
      return { resp2: "unknown[]", resp3: "Resp3Map<unknown>" };
    if (matchSubcommand(types, "USAGE")) return "number | null";
    if (matchSubcommand(types, "DOCTOR")) return "string";
  },
  hrandfield: "string | unknown[] | null",
  hstrlen: "number",
  hvals: "string[]",
  incr: "number",
  incrby: "number",
  incrbyfloat: "string",
  increx: {
    resp2:
      "[value: number, increment: number] | [value: string, increment: string]",
    resp3: "[value: number, increment: number]",
  },
  info: "string",
  lolwut: "string",
  keys: "string[]",
  lastsave: "number",
  lindex: "string | null",
  linsert: "number",
  llen: "number",
  lpop: (types) => {
    return types.some((type) => type.includes("number"))
      ? "string[] | null"
      : "string | null";
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
  msetex: "number",
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
    return types.some((type) => type.includes("number"))
      ? "string[] | null"
      : "string | null";
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
  smismember: "number[]",
  slaveof: "'OK'",
  replicaof: "'OK'",
  smembers: "string[]",
  smove: "number",
  sort: "number | unknown[]",
  sortRo: "unknown[]",
  spop: (types) => (types.length > 1 ? "string[]" : "string | null"),
  srandmember: (types) => (types.length > 1 ? "string[]" : "string | null"),
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
  vadd: { resp2: "number", resp3: "boolean" },
  vcard: "number",
  vdim: "number",
  vemb: { resp2: "string[] | null", resp3: "number[] | null" },
  vgetattr: "string | null",
  vinfo: {
    resp2: "(string | number)[] | null",
    resp3: "Resp3Map<string | number> | null",
  },
  vismember: { resp2: "number", resp3: "boolean" },
  vlinks: "string[][] | null",
  vrandmember: (types) => {
    return types.some((type) => type.includes("number"))
      ? "string[]"
      : "string | null";
  },
  vrange: "string[]",
  vrem: { resp2: "number", resp3: "boolean" },
  vsetattr: { resp2: "number", resp3: "boolean" },
  wait: "number",
  watch: "'OK'",
  zadd: (types) => {
    if (types.find((type) => type.includes("INCR"))) {
      // INCR returns the new score (a DOUBLE), or null when NX/XX skips the add.
      if (types.find((type) => type.includes("XX") || type.includes("NX"))) {
        return { resp2: "string | null", resp3: "Resp3Double<string> | null" };
      }
      return { resp2: "string", resp3: "Resp3Double<string>" };
    }
    return "number";
  },
  zcard: "number",
  zcount: "number",
  zdiff: (types) => {
    if (hasToken(types, "WITHSCORES")) {
      return { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>][]" };
    }
    return "string[]";
  },
  zdiffstore: "number",
  zincrby: { resp2: "string", resp3: "Resp3Double<string>" },
  zinter: (types) => {
    if (hasToken(types, "WITHSCORES")) {
      return { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>][]" };
    }
    return "string[]";
  },
  zintercard: "number",
  zinterstore: "number",
  zlexcount: "number",
  zpopmax: (types) =>
    types.length > 1
      ? { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>][]" }
      : { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>] | []" },
  zpopmin: (types) =>
    types.length > 1
      ? { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>][]" }
      : { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>] | []" },
  zrandmember: (types) => {
    if (hasToken(types, "WITHSCORES")) {
      return { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>][]" };
    }
    return types.some((type) => type.includes("number"))
      ? "string[]"
      : "string | null";
  },
  zrangestore: "number",
  zrange: (types) => {
    if (hasToken(types, "WITHSCORES")) {
      return { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>][]" };
    }
    return "string[]";
  },
  zrangebylex: "string[]",
  zrevrangebylex: "string[]",
  zrangebyscore: (types) => {
    if (hasToken(types, "WITHSCORES")) {
      return { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>][]" };
    }
    return "string[]";
  },
  zrank: (types) => {
    if (hasToken(types, "WITHSCORE")) {
      return {
        resp2: "[rank: number, score: string] | null",
        resp3: "[rank: number, score: Resp3Double<string>] | null",
      };
    }
    return "number | null";
  },
  zrem: "number",
  zremrangebylex: "number",
  zremrangebyrank: "number",
  zremrangebyscore: "number",
  zrevrange: (types) => {
    if (hasToken(types, "WITHSCORES")) {
      return { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>][]" };
    }
    return "string[]";
  },
  zrevrangebyscore: (types) => {
    if (hasToken(types, "WITHSCORES")) {
      return { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>][]" };
    }
    return "string[]";
  },
  zrevrank: (types) => {
    if (hasToken(types, "WITHSCORE")) {
      return {
        resp2: "[rank: number, score: string] | null",
        resp3: "[rank: number, score: Resp3Double<string>] | null",
      };
    }
    return "number | null";
  },
  zscore: { resp2: "string | null", resp3: "Resp3Double<string> | null" },
  zunion: (types) => {
    if (hasToken(types, "WITHSCORES")) {
      return { resp2: "string[]", resp3: "[member: string, score: Resp3Double<string>][]" };
    }
    return "string[]";
  },
  zmscore: { resp2: "(string | null)[]", resp3: "(Resp3Double<string> | null)[]" },
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
  xread: {
    resp2: "[key: string, items: [id: string, fields: string[]][]][] | null",
    resp3: "Resp3Map<[id: string, fields: string[]][]> | null",
  },
  xreadgroup: {
    // Reading the PEL by explicit ID can surface entries whose stream payload
    // was XDEL'd; Redis returns those with a null fields array.
    resp2: "[key: string, items: [id: string, fields: string[] | null][]][] | null",
    resp3: "Resp3Map<[id: string, fields: string[] | null][]> | null",
  },
  xack: "number",
  xnack: "number",
  xclaim: "unknown[]",
  xautoclaim: "unknown[]",
  xpending: "unknown[]",
};
