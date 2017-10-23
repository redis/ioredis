var debug = require('debug');

var MAX_ARGUMENT_LENGTH = 200;

/**
 * helper function that tried to get a string value for
 * arbitrary "debug" arg
 *
 * @param  {mixed} v
 * @return {String|undefined}
 */
function getStringValue(v) {
  if (v === null)
    return;

  switch (typeof v) {
  case 'boolean': return;
  case 'number': return;

  case 'object':
    if (Buffer.isBuffer(v)) {
      return v.toString('hex');
    }

    if (Array.isArray(v)) {
      return v.join(',');
    }

    try {
      return JSON.stringify(v);
    } catch (e) {
      return;
    }

  case 'string': return v;
  }
}

/**
 * helper function that redacts a string representation of a "debug" arg
 *
 * @param  {String} str
 * @param  {Number} max_len
 * @return {String}
 */
function genRedactedString(str, max_len) {
  var len = str.length;

  return len <= max_len ? str : str.slice(0, max_len) + ' ... <REDACTED full-length="' + len + '">';
}

/**
 * a wrapper for the `debug` module, used to generate
 * "debug functions" that trim the values in their output
 *
 * @param   {String}
 * @return  {Function}
 */
module.exports = function genDebugFunction(name) {

  var fn = debug(name);

  function wrappedDebug() {
    if (!fn.enabled) {
      return; // no-op
    }

    var args = [].slice.call(arguments);
    var i = 1, l = args.length, str, len;

    // we skip the first arg because that is the message
    for (; i < l; i += 1) {
      str = getStringValue(args[i]);
      len = str && str.length || 0;

      if (len > MAX_ARGUMENT_LENGTH) {
        args[i] = genRedactedString(str, MAX_ARGUMENT_LENGTH);
      }
    }

    return fn.apply(null, args);
  }

  Object.defineProperties(wrappedDebug, {
    namespace: { get: function () {
      return fn.namespace;
    } },
    enabled: { get: function () {
      return fn.enabled;
    } },
    useColors: { get: function () {
      return fn.useColors;
    } },
    color: { get: function () {
      return fn.color;
    } },
    destroy: { get: function () {
      return fn.destroy;
    } },
    log: {
      get: function () {
        return fn.log;
      },
      set: function (l) {
        fn.log = l;
      }
    }

  });

  return wrappedDebug;
};

// expose private stuff for unit-testing
module.exports.MAX_ARGUMENT_LENGTH = MAX_ARGUMENT_LENGTH;
module.exports.getStringValue = getStringValue;
module.exports.genRedactedString = genRedactedString;
