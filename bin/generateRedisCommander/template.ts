import { Callback } from "../types";

type RedisKey = string | Buffer;
type RedisValue = string | Buffer | number;

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
  ////
}

export default RedisCommander;
