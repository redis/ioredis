/*
 * Portions adapted from node-redis:
 * https://github.com/redis/node-redis
 *
 * Copyright (c) 2022-2023, Redis, Inc.
 * Licensed under the MIT License.
 */
export class VerbatimString extends String {
  constructor(public format: string, value: string) {
    super(value);
  }
}
