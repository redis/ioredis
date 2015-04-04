/** Test if two buffers are equal
 *
 * @param {Buffer} a
 * @param {Buffer} b
 * @return {Boolean} Whether the two buffers are equal
 * @public
 */
exports.bufferEqual = function (a, b) {
  if (typeof a.equals === 'function') {
    return a.equals(b);
  }

  if (a.length !== b.length) {
    return false;
  }

  for (var i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

/** Convert a buffer to string, supports buffer array
 *
 * @param {*} value - The input value
 * @param {string} encoding - string encoding
 * @return {*} The result
 * @example
 * var input = [new Buffer('foo'), [new Buffer('bar')]];
 * var res = convertBufferToString(input, 'utf8');
 * expect(res).to.eql(['foo', ['bar']]);
 * @public
 */
exports.convertBufferToString = function (value, encoding) {
  if (value instanceof Buffer) {
    return value.toString(encoding);
  }
  if (Array.isArray(value)) {
    var res = [];
    for (var i = 0; i < value.length; ++i) {
      res[i] = exports.convertBufferToString(value[i], encoding);
    }
    return res;
  }
  return value;
};
