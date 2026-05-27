import { Buffer } from "buffer";

/**
 * Check if the value is a Uint8Array but not a Buffer.
 */
export function isUint8Array(val: unknown): val is Uint8Array {
  return val instanceof Uint8Array && !Buffer.isBuffer(val);
}

/**
 * Convert a Uint8Array to a Buffer.
 */
export function toBuffer(val: Uint8Array): Buffer {
  return Buffer.from(val.buffer, val.byteOffset, val.byteLength);
}

/**
 * Recursively convert any Uint8Array instances in the argument to Buffer.
 * Supports arrays, Map instances, and plain object literals.
 */
export function checkAndConvertUint8Array(arg: any): any {
  if (isUint8Array(arg)) {
    return toBuffer(arg);
  }
  if (Array.isArray(arg)) {
    return arg.map(checkAndConvertUint8Array);
  }
  if (arg instanceof Map) {
    const newMap = new Map();
    for (const [key, val] of arg.entries()) {
      newMap.set(
        checkAndConvertUint8Array(key),
        checkAndConvertUint8Array(val)
      );
    }
    return newMap;
  }
  if (
    typeof arg === "object" &&
    arg !== null &&
    (Object.getPrototypeOf(arg) === Object.prototype ||
      Object.getPrototypeOf(arg) === null)
  ) {
    const newObj = {};
    for (const key of Object.keys(arg)) {
      newObj[key] = checkAndConvertUint8Array(arg[key]);
    }
    return newObj;
  }
  return arg;
}
