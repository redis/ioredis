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
  extends RedisCommander<{ type: "pipeline" }> {
  length: number;
}

export type ClientContext = {
  type: keyof ResultTypes<unknown, unknown>;
  // Reply mapping the client was built with, mirroring the runtime `replyMapping`.
  // "resp2" (default) flattens RESP3 to RESP2 shapes; absent means "resp2".
  mapping?: "resp2" | "resp3";
};
export type Result<T, Context extends ClientContext> =
  // prettier-break
  ResultTypes<T, Context>[Context["type"]];

// Protocol tags label each branch of a divergent reply so RESP2/RESP3 shapes are
// explicit at the call site. `RespShape` enforces Resp2<...> first, Resp3<...> second.
export type Resp2<T> = { readonly __resp2: T };
export type Resp3<T> = { readonly __resp3: T };
// RESP3 DOUBLE frames always decode to a number, even for *Buffer variants (Buffer
// encoding affects only bulk strings). ReplyString kept for call-site compat, unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type Resp3Double<ReplyString extends string | Buffer = string> = number;
export type Resp3Map<Value> = Record<string, Value>;

// Picks the RESP2 or RESP3 shape for one command from the client's mapping and
// unwraps the tag. Only MAP/DOUBLE differ; defaults to RESP2 when mapping is absent.
export type RespShape<
  Resp2Result extends Resp2<unknown>,
  Resp3Result extends Resp3<unknown>,
  Context extends ClientContext,
> = Context extends { mapping: "resp3" }
  ? Resp3Result["__resp3"]
  : Resp2Result["__resp2"];

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
    callback?: Callback<unknown>,
  ): Result<unknown, Context>;
  call(
    ...args: [
      command: string,
      ...args: (string | Buffer | number)[],
      callback: Callback<unknown>,
    ]
  ): Result<unknown, Context>;
  call(
    ...args: [command: string, ...args: (string | Buffer | number)[]]
  ): Result<unknown, Context>;
  callBuffer(
    command: string,
    callback?: Callback<unknown>,
  ): Result<unknown, Context>;
  callBuffer(
    command: string,
    args: (string | Buffer | number)[],
    callback?: Callback<unknown>,
  ): Result<unknown, Context>;
  callBuffer(
    ...args: [
      command: string,
      ...args: (string | Buffer | number)[],
      callback: Callback<unknown>,
    ]
  ): Result<unknown, Context>;
  callBuffer(
    ...args: [command: string, ...args: (string | Buffer | number)[]]
  ): Result<unknown, Context>;

  ////
}

export default RedisCommander;
