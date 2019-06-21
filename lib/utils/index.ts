import {parse as urllibParse} from 'url'
import {defaults, noop, flatten} from './lodash'
import Debug from './debug'

/**
 * Test if two buffers are equal
 *
 * @export
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {boolean} Whether the two buffers are equal
 */
export function bufferEqual (a: Buffer, b: Buffer): boolean {
  if (typeof a.equals === 'function') {
    return a.equals(b)
  }

  if (a.length !== b.length) {
    return false
  }

  for (var i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

/**
 * Convert a buffer to string, supports buffer array
 *
 * @param {*} value - The input value
 * @param {string} encoding - string encoding
 * @return {*} The result
 * @example
 * ```js
 * var input = [Buffer.from('foo'), [Buffer.from('bar')]]
 * var res = convertBufferToString(input, 'utf8')
 * expect(res).to.eql(['foo', ['bar']])
 * ```
 * @private
 */
export function convertBufferToString (value, encoding) {
  if (value instanceof Buffer) {
    return value.toString(encoding)
  }
  if (Array.isArray(value)) {
    var length = value.length
    var res = Array(length)
    for (var i = 0; i < length; ++i) {
      res[i] = value[i] instanceof Buffer && encoding === 'utf8'
        ? value[i].toString()
        : convertBufferToString(value[i], encoding)
    }
    return res
  }
  return value
}

/**
 * Convert a list of results to node-style
 *
 * @param {Array} arr - The input value
 * @return {Array} The output value
 * @example
 * ```js
 * var input = ['a', 'b', new Error('c'), 'd']
 * var output = exports.wrapMultiResult(input)
 * expect(output).to.eql([[null, 'a'], [null, 'b'], [new Error('c')], [null, 'd'])
 * ```
 * @private
 */
export function wrapMultiResult (arr) {
  // When using WATCH/EXEC transactions, the EXEC will return
  // a null instead of an array
  if (!arr) {
    return null
  }
  var result = []
  var length = arr.length
  for (var i = 0; i < length; ++i) {
    var item = arr[i]
    if (item instanceof Error) {
      result.push([item])
    } else {
      result.push([null, item])
    }
  }
  return result
}

/**
 * Detect the argument is a int
 *
 * @param {string} value
 * @return {boolean} Whether the value is a int
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
 * @private
 */
export function isInt (value) {
  var x = parseFloat(value)
  return !isNaN(value) && (x | 0) === x
}

/**
 * Pack an array to an Object
 *
 * @param {array} array
 * @return {object}
 * @example
 * ```js
 * > packObject(['a', 'b', 'c', 'd'])
 * { a: 'b', c: 'd' }
 * ```
 */
export function packObject (array) {
  var result = {}
  var length = array.length

  for (var i = 1; i < length; i += 2) {
    result[array[i - 1]] = array[i]
  }

  return result
}

/**
 * Return a callback with timeout
 *
 * @param {function} callback
 * @param {number} timeout
 * @return {function}
 */
export function timeout (callback, timeout) {
  var timer
  var run = function () {
    if (timer) {
      clearTimeout(timer)
      timer = null
      callback.apply(this, arguments)
    }
  }
  timer = setTimeout(run, timeout, new Error('timeout'))
  return run
}

/**
 * Convert an object to an array
 *
 * @param {object} obj
 * @return {array}
 * @example
 * ```js
 * > convertObjectToArray({ a: '1' })
 * ['a', '1']
 * ```
 */
export function convertObjectToArray (obj) {
  var result = []
  var keys = Object.keys(obj)

  for (var i = 0, l = keys.length; i < l; i++) {
    result.push(keys[i], obj[keys[i]])
  }
  return result
}

/**
 * Convert a map to an array
 *
 * @param {Map} map
 * @return {array}
 * @example
 * ```js
 * > convertObjectToArray(new Map([[1, '2']]))
 * [1, '2']
 * ```
 */
export function convertMapToArray (map) {
  var result = []
  var pos = 0
  map.forEach(function (value, key) {
    result[pos] = key
    result[pos + 1] = value
    pos += 2
  })
  return result
}

/**
 * Convert a non-string arg to a string
 *
 * @param {*} arg
 * @return {string}
 */
export function toArg (arg) {
  if (arg === null || typeof arg === 'undefined') {
    return ''
  }
  return String(arg)
}

/**
 * Optimize error stack
 *
 * @param {Error} error - actually error
 * @param {string} friendlyStack - the stack that more meaningful
 * @param {string} filterPath - only show stacks with the specified path
 */
export function optimizeErrorStack (error, friendlyStack, filterPath) {
  var stacks = friendlyStack.split('\n')
  var lines = ''
  var i
  for (i = 1; i < stacks.length; ++i) {
    if (stacks[i].indexOf(filterPath) === -1) {
      break
    }
  }
  for (var j = i; j < stacks.length; ++j) {
    lines += '\n' + stacks[j]
  }
  var pos = error.stack.indexOf('\n')
  error.stack = error.stack.slice(0, pos) + lines
  return error
}

/**
 * Parse the redis protocol url
 *
 * @param {string} url - the redis protocol url
 * @return {Object}
 */
export function parseURL (url) {
  if (isInt(url)) {
    return { port: url }
  }
  var parsed = urllibParse(url, true, true)

  if (!parsed.slashes && url[0] !== '/') {
    url = '//' + url
    parsed = urllibParse(url, true, true)
  }

  var result: any = {}
  if (parsed.auth) {
    result.password = parsed.auth.split(':')[1]
  }
  if (parsed.pathname) {
    if (parsed.protocol === 'redis:') {
      if (parsed.pathname.length > 1) {
        result.db = parsed.pathname.slice(1)
      }
    } else {
      result.path = parsed.pathname
    }
  }
  if (parsed.host) {
    result.host = parsed.hostname
  }
  if (parsed.port) {
    result.port = parsed.port
  }
  defaults(result, parsed.query)

  return result
}

/**
 * Get a random element from `array`
 *
 * @export
 * @template T
 * @param {T[]} array the array
 * @param {number} [from=0] start index
 * @returns {T}
 */
export function sample<T> (array: T[], from: number = 0): T {
  const length = array.length
  if (from >= length) {
    return
  }
  return array[from + Math.floor(Math.random() * (length - from))]
}
/**
 * Shuffle the array using the Fisher-Yates Shuffle.
 * This method will mutate the original array.
 *
 * @export
 * @template T
 * @param {T[]} array
 * @returns {T[]}
 */
export function shuffle<T> (array: T[]): T[] {
  let counter = array.length

  // While there are elements in the array
  while (counter > 0) {
    // Pick a random index
    const index = Math.floor(Math.random() * counter)

    // Decrease counter by 1
    counter--

    // And swap the last element with it
    [array[counter], array[index]] = [array[index], array[counter]]
  }

  return array
}


/**
 * Error message for connection being disconnected
 */
export const CONNECTION_CLOSED_ERROR_MSG = 'Connection is closed.'

export function zipMap<K, V> (keys: K[], values: V[]): Map<K, V> {
  const map = new Map<K, V>()
  keys.forEach((key, index) => {
    map.set(key, values[index])
  })
  return map
}

export {
  Debug,
  defaults,
  noop,
  flatten
}
