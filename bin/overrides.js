const msetOverrides = {
  overwrite: false,
  defs: [
    "$1(object: object, callback?: Callback<'OK'>): Result<'OK', Context>",
    "$1(map: Map<string | Buffer | number, string | Buffer | number>, callback?: Callback<'OK'>): Result<'OK', Context>",
  ],
};

module.exports = {
  hgetall: {
    overwrite: true,
    defs: [
      "$1(key: RedisKey, callback?: Callback<Record<string, string>>): Result<Record<string, string>, Context>",
      "$1Buffer(key: RedisKey, callback?: Callback<Record<string, Buffer>>): Result<Record<string, Buffer>, Context>",
    ],
  },
  mset: msetOverrides,
  msetnx: msetOverrides,
  hset: {
    overwrite: false,
    defs: [
      "$1(key: RedisKey, object: object, callback?: Callback<number>): Result<number, Context>",
      "$1(key: RedisKey, map: Map<string | Buffer | number, string | Buffer | number>, callback?: Callback<number>): Result<number, Context>",
    ],
  },
  hmset: {
    overwrite: false,
    defs: [
      "$1(key: RedisKey, object: object, callback?: Callback<'OK'>): Result<'OK', Context>",
      "$1(key: RedisKey, map: Map<string | Buffer | number, string | Buffer | number>, callback?: Callback<'OK'>): Result<'OK', Context>",
    ],
  },
  exec: {
    overwrite: true,
    defs: [
      "exec(callback?: Callback<[error: Error | null, result: unknown][] | null>): Promise<[error: Error | null, result: unknown][] | null>;",
    ],
  },
};
