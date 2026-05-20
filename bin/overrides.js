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
  argrep: {
    overwrite: true,
    defs: [
      "$1(key: RedisKey, start: number | string, end: number | string, predicate: 'EXACT' | 'MATCH' | 'GLOB' | 'RE', value: RedisValue, callback: Callback<number[]>): Result<number[], Context>;",
      "$1(...args: [key: RedisKey, start: number | string, end: number | string, predicate: 'EXACT' | 'MATCH' | 'GLOB' | 'RE', value: RedisValue, ...args: RedisValue[], callback: Callback<number[] | (number | string)[]>]): Result<number[] | (number | string)[], Context>;",
      "$1<T extends RedisValue[]>(...args: [key: RedisKey, start: number | string, end: number | string, predicate: 'EXACT' | 'MATCH' | 'GLOB' | 'RE', value: RedisValue, ...args: T]): Result<'WITHVALUES' extends T[number] ? (number | string)[] : number[], Context>;",
      "$1Buffer(key: RedisKey, start: number | string, end: number | string, predicate: 'EXACT' | 'MATCH' | 'GLOB' | 'RE', value: RedisValue, callback: Callback<number[]>): Result<number[], Context>;",
      "$1Buffer(...args: [key: RedisKey, start: number | string, end: number | string, predicate: 'EXACT' | 'MATCH' | 'GLOB' | 'RE', value: RedisValue, ...args: RedisValue[], callback: Callback<number[] | (number | Buffer)[]>]): Result<number[] | (number | Buffer)[], Context>;",
      "$1Buffer<T extends RedisValue[]>(...args: [key: RedisKey, start: number | string, end: number | string, predicate: 'EXACT' | 'MATCH' | 'GLOB' | 'RE', value: RedisValue, ...args: T]): Result<'WITHVALUES' extends T[number] ? (number | Buffer)[] : number[], Context>;",
    ],
  },
  exec: {
    overwrite: true,
    defs: [
      "exec(callback?: Callback<[error: Error | null, result: unknown][] | null>): Promise<[error: Error | null, result: unknown][] | null>;",
    ],
  },
};
