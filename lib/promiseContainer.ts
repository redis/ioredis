export function isPromise (obj: any): boolean {
  return !!obj &&
    (typeof obj === 'object' || typeof obj === 'function') &&
    typeof obj.then === 'function'
}

let promise = global.Promise

export function get (): Function {
  return promise
}

export function set (lib: Function): void {
  if (typeof lib !== 'function') {
    throw new Error(`Provided Promise must be a function, got ${lib}`)
  }

  promise = lib
}
