exports.isPromise = function (obj) {
  return !!obj &&
    (typeof obj === 'object' || typeof obj === 'function') &&
    typeof obj.then === 'function'
}

let promise = global.Promise

exports.get = function () {
  return promise
}

exports.set = function (lib) {
  if (typeof lib !== 'function') {
    throw new Error(`Provided Promise must be a function, got ${lib}`)
  }

  promise = lib
}
