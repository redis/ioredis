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

// `extends String` leaves String.prototype in V8 dictionary mode, which slows
// down string methods in the whole process; this store makes it fast again.
Object.create(String.prototype).ioredisVerbatimString = true;
