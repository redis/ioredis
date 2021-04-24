// TODO: use 'import { once } from "events";' instead of this
// after upgrading minimum Node.js version to 10.16+

// This polyfill is from https://github.com/davidmarkclements/events.once

import EventEmitter from "events";

export const once = <T extends any[]>(
  emitter: EventEmitter,
  name: string
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const onceError = name === "error";
    const listener = onceError
      ? resolve
      : (...args: any[]) => {
          emitter.removeListener("error", error);
          resolve(args as T);
        };
    emitter.once(name, listener);
    if (onceError) return;
    const error = (err: any) => {
      emitter.removeListener(name, listener);
      reject(err);
    };
    emitter.once("error", error);
  });
};
