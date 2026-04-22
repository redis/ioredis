/*
 * Derived from `src/compat/object/defaults.ts` in es-toolkit
 * (https://github.com/toss/es-toolkit).
 *
 * Copyright (c) 2024 Viva Republica, Inc
 * Copyright OpenJS Foundation and other contributors
 *
 * Parts of the compatibility layer in `es-toolkit/compat` are derived from
 * Lodash (https://github.com/lodash/lodash) by the OpenJS Foundation
 * (https://openjsf.org/) and Underscore.js by Jeremy Ashkenas, DocumentCloud
 * and Investigative Reporters & Editors (http://underscorejs.org/).
 *
 * This file has been modified from the original source to create a standalone
 * adaptation.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const IS_UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;

type DefaultSource = object | null | undefined;

function isNil(value: unknown): value is null | undefined {
  return value == null;
}

function eq(value: unknown, other: unknown): boolean {
  return value === other || (Number.isNaN(value) && Number.isNaN(other));
}

function isLength(value?: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isArrayLike(value?: unknown): value is { length: number } {
  return (
    value != null &&
    typeof value !== "function" &&
    isLength((value as ArrayLike<unknown>).length)
  );
}

function isObject(value?: unknown): value is object {
  return (
    value !== null && (typeof value === "object" || typeof value === "function")
  );
}

function isIndex(
  value: PropertyKey,
  length = Number.MAX_SAFE_INTEGER,
): boolean {
  switch (typeof value) {
    case "number":
      return Number.isInteger(value) && value >= 0 && value < length;
    case "symbol":
      return false;
    case "string":
      return IS_UNSIGNED_INTEGER.test(value);
  }
}

function isIterateeCall(
  value: unknown,
  index: unknown,
  object: unknown,
): boolean {
  if (!isObject(object)) {
    return false;
  }

  if (
    (typeof index === "number" &&
      isArrayLike(object) &&
      isIndex(index) &&
      index < object.length) ||
    (typeof index === "string" && index in object)
  ) {
    return eq((object as any)[index], value);
  }

  return false;
}

export function defaults<T, S>(object: T, source: S): NonNullable<S & T>;
export function defaults<T, S1, S2>(
  object: T,
  source1: S1,
  source2: S2,
): NonNullable<S2 & S1 & T>;
export function defaults<T, S1, S2, S3>(
  object: T,
  source1: S1,
  source2: S2,
  source3: S3,
): NonNullable<S3 & S2 & S1 & T>;
export function defaults<T, S1, S2, S3, S4>(
  object: T,
  source1: S1,
  source2: S2,
  source3: S3,
  source4: S4,
): NonNullable<S4 & S3 & S2 & S1 & T>;
export function defaults<T>(object: T): NonNullable<T>;
export function defaults(object: any, ...sources: any[]): any;
export function defaults<T extends object, S extends object>(
  object: T,
  ...sources: DefaultSource[]
): object {
  object = Object(object);
  const objectProto = Object.prototype;

  let length = sources.length;
  const guard = length > 2 ? sources[2] : undefined;
  if (guard && isIterateeCall(sources[0], sources[1], guard)) {
    length = 1;
  }

  for (let i = 0; i < length; i++) {
    if (isNil(sources[i])) {
      continue;
    }

    const source = sources[i] as Record<string, unknown>;
    const keys = Object.keys(source);

    for (let j = 0; j < keys.length; j++) {
      const key = keys[j];
      const value = (object as any)[key];

      if (
        value === undefined ||
        (!objectProto.hasOwnProperty.call(object, key) &&
          eq(value, objectProto[key as keyof typeof objectProto]))
      ) {
        (object as any)[key] = source[key];
      }
    }
  }

  return object;
}
