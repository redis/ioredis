var _ = require('lodash');
var Promise = require('bluebird');
var fbuffer = require('flexbuffer');
var utils = require('./utils');
/**
 * Command instance
 *
 * It's rare that you need to create a Command instance yourself.
 *
 * @constructor
 * @param {string} name - Command name
 * @param {string[]} [args=null] - An array of command arguments
 * @param {string} [replyEncoding=null] - Set the encoding of the reply,
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
  this.name = name;
  this.replyEncoding = options && options.replyEncoding;
  this.errorStack = options && options.errorStack;
  this.args = args ? _.flatten(args) : [];

  var _this = this;
  this.promise = new Promise(function (resolve, reject) {
    _this.resolve = _this._convertValue(resolve);
    if (_this.errorStack) {
      _this.reject = function (err) {
        reject(utils.optimizeErrorStack(err, _this.errorStack, __dirname));
      };
    } else {
      _this.reject = reject;
    }

    var transformer = Command._transformer.argument[_this.name];
    if (transformer) {
      _this.args = transformer(_this.args);
    }
  }).nodeify(callback);
}

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
    var resultBuffer = new fbuffer.FlexBuffer();
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
        if (typeof arg !== 'string') {
          arg = utils.toArg(arg);
        }
        resultBuffer.write('$' + Buffer.byteLength(arg) + '\r\n' + arg + '\r\n');
      }
    }
    result = resultBuffer.getBuffer();
  } else {
    result = commandStr;
    for (i = 0; i < this.args.length; ++i) {
      arg = (typeof this.args[i] === 'string') ? this.args[i] : utils.toArg(this.args[i]);
      result += '$' + Buffer.byteLength(arg) + '\r\n' + arg + '\r\n';
    }
  }
  return result;
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

module.exports = Command;
