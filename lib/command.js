'use strict';

var _ = require('lodash');
var Promise = require('bluebird');
var fbuffer = require('flexbuffer');
var utils = require('./utils');
var commands = require('../commands');

/**
 * Command instance
 *
 * It's rare that you need to create a Command instance yourself.
 *
 * @constructor
 * @param {string} name - Command name
 * @param {string[]} [args=null] - An array of command arguments
 * @param {object} [options]
 * @param {string} [options.replyEncoding=null] - Set the encoding of the reply,
 * by default buffer will be returned.
 * @param {function} [callback=null] - The callback that handles the response.
 * If omit, the response will be handled via Promise.
 * @example
 * ```js
 * var infoCommand = new Command('info', null, function (err, result) {
 *   console.log('result', result);
 * });
 *
 * redis.sendCommand(infoCommand);
 *
 * // When no callback provided, Command instance will have a `promise` property,
 * // which will resolve/reject with the result of the command.
 * var getCommand = new Command('get', ['foo']);
 * getCommand.promise.then(function (result) {
 *   console.log('result', result);
 * });
 * ```
 *
 * @see {@link Redis#sendCommand} which can send a Command instance to Redis
 * @public
 */
function Command(name, args, options, callback) {
  if (typeof options === 'undefined') {
    options = {};
  }
  this.name = name;
  this.replyEncoding = options.replyEncoding;
  this.errorStack = options.errorStack;
  this.args = args ? _.flatten(args) : [];
  var keyPrefix = options.keyPrefix;
  if (keyPrefix) {
    this._iterateKeys(function (key) {
      return keyPrefix + key;
    });
  }
  this.callback = callback;
  this.initPromise();
}

Command.prototype.initPromise = function () {
  var _this = this;
  this.promise = new Promise(function (resolve, reject) {
    if (!_this.transformed) {
      _this.transformed = true;
      var transformer = Command._transformer.argument[_this.name];
      if (transformer) {
        _this.args = transformer(_this.args);
      }
      _this.stringifyArguments();
    }

    _this.resolve = _this._convertValue(resolve);
    if (_this.errorStack) {
      _this.reject = function (err) {
        reject(utils.optimizeErrorStack(err, _this.errorStack, __dirname));
      };
    } else {
      _this.reject = reject;
    }
  }).nodeify(this.callback);
};

Command.prototype.getSlot = function () {
  if (typeof this._slot === 'undefined') {
    var key = this.getKeys()[0];
    if (key) {
      this.slot = utils.calcSlot(key);
    } else {
      this.slot = null;
    }
  }
  return this.slot;
};

Command.prototype.getKeys = function () {
  return this._iterateKeys();
};

/**
 * Iterate through the command arguments that are considered keys.
 *
 * @param {function} [transform] - The transformation that should be applied to
 * each key. The transformations will persist.
 * @return {string[]} The keys of the command.
 * @private
 */
Command.prototype._iterateKeys = function (transform) {
  if (typeof this._keys === 'undefined') {
    if (typeof transform !== 'function') {
      transform = function (key) {
        return key;
      };
    }
    this._keys = [];
    var i, keyStart, keyStop;
    var def = commands[this.name];
    if (def) {
      switch (this.name) {
      case 'eval':
      case 'evalsha':
        keyStop = parseInt(this.args[1], 10) + 2;
        for (i = 2; i < keyStop; ++i) {
          this.args[i] = transform(this.args[i]);
          this._keys.push(this.args[i]);
        }
        break;
      case 'sort':
        this.args[0] = transform(this.args[0]);
        this._keys.push(this.args[0]);
        for (i = 1; i < this.args.length - 1; ++i) {
          if (typeof this.args[i] !== 'string') {
            continue;
          }
          var directive = this.args[i].toUpperCase();
          if (directive === 'GET') {
            i += 1;
            if (this.args[i] !== '#') {
              this.args[i] = transform(this.args[i]);
              this._keys.push(this.getKeyPart(this.args[i]));
            }
          } else if (directive === 'BY') {
            i += 1;
            this.args[i] = transform(this.args[i]);
            this._keys.push(this.getKeyPart(this.args[i]));
          } else if (directive === 'STORE') {
            i += 1;
            this.args[i] = transform(this.args[i]);
            this._keys.push(this.args[i]);
          }
        }
        break;
      case 'zunionstore':
      case 'zinterstore':
        this.args[0] = transform(this.args[0]);
        this._keys.push(this.args[0]);
        keyStop = parseInt(this.args[1], 10) + 2;
        for (i = 2; i < keyStop; ++i) {
          this.args[i] = transform(this.args[i]);
          this._keys.push(this.args[i]);
        }
        break;
      default:
        keyStart = def.keyStart - 1;
        keyStop = def.keyStop > 0 ? def.keyStop : this.args.length + def.keyStop + 1;
        if (keyStart >= 0 && keyStop <= this.args.length && keyStop > keyStart && def.step > 0) {
          for (i = keyStart; i < keyStop; i += def.step) {
            this.args[i] = transform(this.args[i]);
            this._keys.push(this.args[i]);
          }
        }
        break;
      }
    }
  }
  return this._keys;
};

Command.prototype.getKeyPart = function (key) {
  var starPos = key.indexOf('*');
  if (starPos === -1) {
    return key;
  }
  var hashPos = key.indexOf('->', starPos + 1);
  if (hashPos === 1) {
    return key;
  }
  return key.slice(0, hashPos);
};

/**
 * Convert command to writable buffer or string
 *
 * @return {string|Buffer}
 * @see {@link Redis#sendCommand}
 * @public
 */
Command.prototype.toWritable = function () {
  var bufferMode = false;
  var i;
  for (i = 0; i < this.args.length; ++i) {
    if (this.args[i] instanceof Buffer) {
      bufferMode = true;
      break;
    }
  }

  var result, arg;
  var commandStr = '*' + (this.args.length + 1) + '\r\n$' + this.name.length + '\r\n' + this.name + '\r\n';
  if (bufferMode) {
    var resultBuffer = new fbuffer.FlexBuffer(0);
    resultBuffer.write(commandStr);
    for (i = 0; i < this.args.length; ++i) {
      arg = this.args[i];
      if (arg instanceof Buffer) {
        if (arg.length === 0) {
          resultBuffer.write('$0\r\n\r\n');
        } else {
          resultBuffer.write('$' + arg.length + '\r\n');
          resultBuffer.write(arg);
          resultBuffer.write('\r\n');
        }
      } else {
        resultBuffer.write('$' + Buffer.byteLength(arg) + '\r\n' + arg + '\r\n');
      }
    }
    result = resultBuffer.getBuffer();
  } else {
    result = commandStr;
    for (i = 0; i < this.args.length; ++i) {
      result += '$' + Buffer.byteLength(this.args[i]) + '\r\n' + this.args[i] + '\r\n';
    }
  }
  return result;
};

Command.prototype.stringifyArguments = function () {
  for (var i = 0; i < this.args.length; ++i) {
    if (!(this.args[i] instanceof Buffer) && typeof this.args[i] !== 'string') {
      this.args[i] = utils.toArg(this.args[i]);
    }
  }
};

/**
 * Convert the value from buffer to the target encoding.
 *
 * @param {function} resolve - The resolve function of the Promise
 * @return {function} A funtion to transform and resolve a value
 * @private
 */
Command.prototype._convertValue = function (resolve) {
  var _this = this;
  return function (value) {
    // Convert buffer/buffer[] to string/string[]
    var result = value;
    var transformer;
    try {
      if (_this.replyEncoding) {
        result = utils.convertBufferToString(value, _this.replyEncoding);
      }
      transformer = Command._transformer.reply[_this.name];
      if (transformer) {
        result = transformer(result);
      }
      resolve(result);
    } catch (err) {
      _this.reject(err);
    }
    return _this.promise;
  };
};

Command.FLAGS = {
  // Commands that can be processed when Redis is loading data from disk
  VALID_WHEN_LOADING: ['info', 'auth', 'select', 'subscribe', 'unsubscribe', 'psubscribe', 'pubsubscribe', 'publish', 'shutdown', 'replconf', 'role', 'pubsub', 'command', 'latency'],
  // Commands that can be processed when client is in the subscriber mode
  VALID_IN_SUBSCRIBER_MODE: ['subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe', 'ping', 'quit'],
  // Commands that are valid in monitor mode
  VALID_IN_MONITOR_MODE: ['monitor', 'auth'],
  // Commands that will turn current connection into subscriber mode
  ENTER_SUBSCRIBER_MODE: ['subscribe', 'psubscribe'],
  // Commands that may make current connection quit subscriber mode
  EXIT_SUBSCRIBER_MODE: ['unsubscribe', 'punsubscribe'],
  // Commands that will make client disconnect from server TODO shutdown?
  WILL_DISCONNECT: ['quit']
};

Command._transformer = {
  argument: {},
  reply: {}
};

Command.setArgumentTransformer = function (name, func) {
  Command._transformer.argument[name] = func;
};

Command.setReplyTransformer = function (name, func) {
  Command._transformer.reply[name] = func;
};

Command.setArgumentTransformer('mset', function (args) {
  if (args.length === 1) {
    if (typeof Map !== 'undefined' && args[0] instanceof Map) {
      return utils.convertMapToArray(args[0]);
    }
    if ( typeof args[0] === 'object' && args[0] !== null) {
      return utils.convertObjectToArray(args[0]);
    }
  }
  return args;
});

Command.setArgumentTransformer('hmset', function (args) {
  if (args.length === 2) {
    if (typeof Map !== 'undefined' && args[1] instanceof Map) {
      return [args[0]].concat(utils.convertMapToArray(args[1]));
    }
    if ( typeof args[1] === 'object' && args[1] !== null) {
      return [args[0]].concat(utils.convertObjectToArray(args[1]));
    }
  }
  return args;
});

Command.setReplyTransformer('hgetall', function (result) {
  if (Array.isArray(result)) {
    var obj = {};
    for (var i = 0; i < result.length; i += 2) {
      obj[result[i]] = result[i + 1];
    }
    return obj;
  }
  return result;
});

module.exports = Command;
