'use strict';

var _ = require('lodash');
var Command = require('./command');
var Script = require('./script');
var Promise = require('bluebird');

var DROP_BUFFER_SUPPORT_ERROR = '*Buffer methods are not available ' +
  'because "dropBufferSupport" option is enabled.' +
  'Refer to https://github.com/luin/ioredis/wiki/Improve-Performance for more details.';

/**
 * Commander
 *
 * This is the base class of Redis, Redis.Cluster and Pipeline
 *
 * @param {boolean} [options.showFriendlyErrorStack=false] - Whether to show a friendly error stack.
 * Will decrease the performance significantly.
 * @constructor
 */
function Commander() {
  this.options = _.defaults({}, this.options || {}, {
    showFriendlyErrorStack: false
  });
  this.scriptsSet = {};
}

var commands = _.difference(require('redis-commands').list, ['monitor']);
commands.push('sentinel');

/**
 * Return supported builtin commands
 *
 * @return {string[]} command list
 * @public
 */
Commander.prototype.getBuiltinCommands = function () {
  return _.clone(commands);
};

/**
 * Create a builtin command
 *
 * @param {string} commandName - command name
 * @return {object} functions
 * @public
 */
Commander.prototype.createBuiltinCommand = function (commandName) {
  return {
    string: generateFunction(commandName, 'utf8'),
    buffer: generateFunction(commandName, null)
  };
};

_.forEach(commands, function (commandName) {
  Commander.prototype[commandName] = generateFunction(commandName, 'utf8');
  Commander.prototype[commandName + 'Buffer'] = generateFunction(commandName, null);
});

Commander.prototype.call = generateFunction('utf8');
Commander.prototype.callBuffer = generateFunction(null);
Commander.prototype.send_command = Commander.prototype.call;

/**
 * Define a custom command using lua script
 *
 * @param {string} name - the command name
 * @param {object} definition
 * @param {string} definition.lua - the lua code
 * @param {number} [definition.numberOfKeys=null] - the number of keys.
 * If omit, you have to pass the number of keys as the first argument every time you invoke the command
 */
Commander.prototype.defineCommand = function (name, definition) {
  var script = new Script(definition.lua, definition.numberOfKeys,
                          this.options.keyPrefix);
  this.scriptsSet[name] = script;
  this[name] = generateScriptingFunction(script, 'utf8');
  this[name + 'Buffer'] = generateScriptingFunction(script, null);
};

/**
 * Send a command
 *
 * @abstract
 * @public
 */
Commander.prototype.sendCommand = function () {};

function generateFunction(_commandName, _encoding) {
  if (typeof _encoding === 'undefined') {
    _encoding = _commandName;
    _commandName = null;
  }
  return function () {
    var firstArgIndex = 0;
    var commandName = _commandName;
    if (commandName === null) {
      commandName = arguments[0];
      firstArgIndex = 1;
    }
    var length = arguments.length;
    var lastArgIndex = length - 1;
    var callback = arguments[lastArgIndex];
    if (typeof callback !== 'function') {
      callback = undefined;
    } else {
      length = lastArgIndex;
    }
    var args = new Array(length - firstArgIndex);
    for (var i = firstArgIndex; i < length; ++i) {
      args[i - firstArgIndex] = arguments[i];
    }

    var options;
    if (this.options.dropBufferSupport) {
      if (!_encoding) {
        return Promise.reject(new Error(DROP_BUFFER_SUPPORT_ERROR)).nodeify(callback);
      }
      options = { replyEncoding: null };
    } else {
      options = { replyEncoding: _encoding };
    }

    if (this.options.showFriendlyErrorStack) {
      options.errorStack = new Error().stack;
    }
    if (this.options.keyPrefix) {
      options.keyPrefix = this.options.keyPrefix;
    }

    return this.sendCommand(new Command(commandName, args, options, callback));
  };
}

function generateScriptingFunction(_script, _encoding) {
  return function () {
    var length = arguments.length;
    var lastArgIndex = length - 1;
    var callback = arguments[lastArgIndex];
    if (typeof callback !== 'function') {
      callback = undefined;
    } else {
      length = lastArgIndex;
    }
    var args = new Array(length);
    for (var i = 0; i < length; i++) {
      args[i] = arguments[i];
    }

    var options;
    if (this.options.dropBufferSupport) {
      if (!_encoding) {
        return Promise.reject(new Error(DROP_BUFFER_SUPPORT_ERROR)).nodeify(callback);
      }
      options = { replyEncoding: null };
    } else {
      options = { replyEncoding: _encoding };
    }

    if (this.options.showFriendlyErrorStack) {
      options.errorStack = new Error().stack;
    }

    return _script.execute(this, args, options, callback);
  };
}

module.exports = Commander;
