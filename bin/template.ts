import { Callback } from "../types";

export type RedisKey = string | Buffer;
export type RedisValue = string | Buffer | number;

// Inspired by https://github.com/mmkal/handy-redis/blob/main/src/generated/interface.ts.
// Should be fixed with https://github.com/Microsoft/TypeScript/issues/1213
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ResultTypes<Result, Context> {
  default: Promise<Result>;
  pipeline: ChainableCommander;
}

export interface ChainableCommander
  extends RedisCommander<{ type: "pipeline" }> {}

export type ClientContext = { type: keyof ResultTypes<unknown, unknown> };
export type Result<T, Context extends ClientContext> =
  // prettier-break
  ResultTypes<T, Context>[Context["type"]];

interface RedisCommander<Context extends ClientContext = { type: "default" }> {
  /**
   * Call arbitrary commands.
   *
   * `redis.call('set', 'foo', 'bar')` is the same as `redis.set('foo', 'bar')`,
   * so the only case you need to use this method is when the command is not
   * supported by ioredis.
   *
   * ```ts
   * redis.call('set', 'foo', 'bar');
   * redis.call('get', 'foo', (err, value) => {
   *   // value === 'bar'
   * });
   * ```
   */
  call(command: string, callback?: Callback<unknown>): Result<unknown, Context>;
  call(
    command: string,
    args: (string | Buffer | number)[],
    callback?: Callback<unknown>
  ): Result<unknown, Context>;
  call(
    ...args: [
      command: string,
      ...args: (string | Buffer | number)[],
      callback: Callback<unknown>
    ]
  ): Result<unknown, Context>;
  call(
    ...args: [command: string, ...args: (string | Buffer | number)[]]
  ): Result<unknown, Context>;
  callBuffer(
    command: string,
    callback?: Callback<unknown>
  ): Result<unknown, Context>;
  callBuffer(
    command: string,
    args: (string | Buffer | number)[],
    callback?: Callback<unknown>
  ): Result<unknown, Context>;
  callBuffer(
    ...args: [
      command: string,
      ...args: (string | Buffer | number)[],
      callback: Callback<unknown>
    ]
  ): Result<unknown, Context>;
  callBuffer(
    ...args: [command: string, ...args: (string | Buffer | number)[]]
  ): Result<unknown, Context>;

  ////
}

export default RedisCommander;
