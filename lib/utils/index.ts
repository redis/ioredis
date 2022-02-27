import { parse as urllibParse } from "url";
import { defaults, noop } from "./lodash";
import { Callback } from "../types";
import Debug from "./debug";

import TLSProfiles from "../constants/TLSProfiles";

/**
 * Convert a buffer to string, supports buffer array
 *
 * @example
 * ```js
 * const input = [Buffer.from('foo'), [Buffer.from('bar')]]
 * const res = convertBufferToString(input, 'utf8')
 * expect(res).to.eql(['foo', ['bar']])
 * ```
 */
export function convertBufferToString(value: any, encoding?: BufferEncoding) {
  if (value instanceof Buffer) {
    return value.toString(encoding);
  }
  if (Array.isArray(value)) {
    const length = value.length;
    const res = Array(length);
    for (let i = 0; i < length; ++i) {
      res[i] =
        value[i] instanceof Buffer && encoding === "utf8"
          ? value[i].toString()
          : convertBufferToString(value[i], encoding);
    }
    return res;
  }
  return value;
}

/**
 * Convert a list of results to node-style
 *
 * @example
 * ```js
 * const input = ['a', 'b', new Error('c'), 'd']
 * const output = exports.wrapMultiResult(input)
 * expect(output).to.eql([[null, 'a'], [null, 'b'], [new Error('c')], [null, 'd'])
 * ```
 */
export function wrapMultiResult(arr: unknown[] | null): unknown[][] {
  // When using WATCH/EXEC transactions, the EXEC will return
  // a null instead of an array
  if (!arr) {
    return null;
  }
  const result = [];
  const length = arr.length;
  for (let i = 0; i < length; ++i) {
    const item = arr[i];
    if (item instanceof Error) {
      result.push([item]);
    } else {
      result.push([null, item]);
    }
  }
  return result;
}

/**
 * Detect if the argument is a int
 * @example
 * ```js
 * > isInt('123')
 * true
 * > isInt('123.3')
 * false
 * > isInt('1x')
 * false
 * > isInt(123)
 * true
 * > isInt(true)
 * false
 * ```
 */
export function isInt(value: any): value is string {
  const x = parseFloat(value);
  return !isNaN(value) && (x | 0) === x;
}

/**
 * Pack an array to an Object
 *
 * @example
 * ```js
 * > packObject(['a', 'b', 'c', 'd'])
 * { a: 'b', c: 'd' }
 * ```
 */
export function packObject(array: any[]): Record<string, any> {
  const result = {};
  const length = array.length;

  for (let i = 1; i < length; i += 2) {
    result[array[i - 1]] = array[i];
  }

  return result;
}

/**
 * Return a callback with timeout
 */
export function timeout<T>(
  callback: Callback<T>,
  timeout: number
): Callback<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run: Callback<T> = function () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      callback.apply(this, arguments);
    }
  };
  timer = setTimeout(run, timeout, new Error("timeout"));
  return run;
}

/**
 * Convert an object to an array
 * @example
 * ```js
 * > convertObjectToArray({ a: '1' })
 * ['a', '1']
 * ```
 */
export function convertObjectToArray<T>(
  obj: Record<string, T>
): (string | T)[] {
  const result = [];
  const keys = Object.keys(obj); // Object.entries requires node 7+

  for (let i = 0, l = keys.length; i < l; i++) {
    result.push(keys[i], obj[keys[i]]);
  }
  return result;
}

/**
 * Convert a map to an array
 * @example
 * ```js
 * > convertMapToArray(new Map([[1, '2']]))
 * [1, '2']
 * ```
 */
export function convertMapToArray<K, V>(map: Map<K, V>): (K | V)[] {
  const result: Array<K | V> = [];
  let pos = 0;
  map.forEach(function (value, key) {
    result[pos] = key;
    result[pos + 1] = value;
    pos += 2;
  });
  return result;
}

/**
 * Convert a non-string arg to a string
 */
export function toArg(arg: any): string {
  if (arg === null || typeof arg === "undefined") {
    return "";
  }
  return String(arg);
}

/**
 * Optimize error stack
 *
 * @param error actually error
 * @param friendlyStack the stack that more meaningful
 * @param filterPath only show stacks with the specified path
 */
export function optimizeErrorStack(
  error: Error,
  friendlyStack: string,
  filterPath: string
) {
  const stacks = friendlyStack.split("\n");
  let lines = "";
  let i;
  for (i = 1; i < stacks.length; ++i) {
    if (stacks[i].indexOf(filterPath) === -1) {
      break;
    }
  }
  for (let j = i; j < stacks.length; ++j) {
    lines += "\n" + stacks[j];
  }
  const pos = error.stack.indexOf("\n");
  error.stack = error.stack.slice(0, pos) + lines;
  return error;
}

/**
 * Parse the redis protocol url
 */
export function parseURL(url: string): Record<string, unknown> {
  if (isInt(url)) {
    return { port: url };
  }
  let parsed = urllibParse(url, true, true);

  if (!parsed.slashes && url[0] !== "/") {
    url = "//" + url;
    parsed = urllibParse(url, true, true);
  }

  const options = parsed.query || {};
  const allowUsernameInURI =
    options.allowUsernameInURI && options.allowUsernameInURI !== "false";
  delete options.allowUsernameInURI;

  const result: any = {};
  if (parsed.auth) {
    const index = parsed.auth.indexOf(":");
    if (allowUsernameInURI) {
      result.username =
        index === -1 ? parsed.auth : parsed.auth.slice(0, index);
    }
    result.password = index === -1 ? "" : parsed.auth.slice(index + 1);
  }
  if (parsed.pathname) {
    if (parsed.protocol === "redis:" || parsed.protocol === "rediss:") {
      if (parsed.pathname.length > 1) {
        result.db = parsed.pathname.slice(1);
      }
    } else {
      result.path = parsed.pathname;
    }
  }
  if (parsed.host) {
    result.host = parsed.hostname;
  }
  if (parsed.port) {
    result.port = parsed.port;
  }
  defaults(result, options);

  return result;
}

interface TLSOptions {
  port: number;
  host: string;
  [key: string]: any;
}

/**
 * Resolve TLS profile shortcut in connection options
 */
export function resolveTLSProfile(options: TLSOptions): TLSOptions {
  let tls = options?.tls;

  if (typeof tls === "string") tls = { profile: tls };

  const profile = TLSProfiles[tls?.profile];

  if (profile) {
    tls = Object.assign({}, profile, tls);
    delete tls.profile;
    options = Object.assign({}, options, { tls });
  }

  return options;
}

/**
 * Get a random element from `array`
 */
export function sample<T>(array: T[], from = 0): T {
  const length = array.length;
  if (from >= length) {
    return;
  }
  return array[from + Math.floor(Math.random() * (length - from))];
}
/**
 * Shuffle the array using the Fisher-Yates Shuffle.
 * This method will mutate the original array.
 */
export function shuffle<T>(array: T[]): T[] {
  let counter = array.length;

  // While there are elements in the array
  while (counter > 0) {
    // Pick a random index
    const index = Math.floor(Math.random() * counter);

    // Decrease counter by 1
    counter--;

    // And swap the last element with it
    [array[counter], array[index]] = [array[index], array[counter]];
  }

  return array;
}

/**
 * Error message for connection being disconnected
 */
export const CONNECTION_CLOSED_ERROR_MSG = "Connection is closed.";

export function zipMap<K, V>(keys: K[], values: V[]): Map<K, V> {
  const map = new Map<K, V>();
  keys.forEach((key, index) => {
    map.set(key, values[index]);
  });
  return map;
}

export { Debug, defaults, noop };
