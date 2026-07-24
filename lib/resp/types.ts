/*
 * Portions adapted from node-redis:
 * https://github.com/redis/node-redis
 *
 * Copyright (c) 2022-2023, Redis, Inc.
 * Licensed under the MIT License.
 */
import { RESP_TYPES } from "./decoder";

export type RESP_TYPES = typeof RESP_TYPES;

export type RespTypes = RESP_TYPES[keyof RESP_TYPES];

export type MappedType<T = unknown> =
  | ((...args: any[]) => T)
  | (new (...args: any[]) => T);

export type TypeMapping = {
  [P in RespTypes]?: MappedType;
};
