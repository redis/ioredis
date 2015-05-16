'use strict';

var _ = require('lodash');
var Command = require('./command');
var Script = require('./script');

/**
 * Commander
 *
 * @param {boolean} [options.showFriendlyErrorStack=false] - Whether to show a friendly error stack. Will decrease the performance significantly.
 * @constructor
 */
function Commander() {
  this.options = _.defaults(this.options || {}, {
    showFriendlyErrorStack: false
  });
  this.scriptsSet = {};
}

var commands = _.difference(_.keys(require('../commands'), ['monitor']));
commands.push('sentinel', 'quit');

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
  var script = new Script(definition.lua, definition.numberOfKeys);
  this.scriptsSet[name] = script;
  this[name] = function () {
    var args = _.toArray(arguments);
    var callback;

    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    var options = { replyEncoding: 'utf8' };
    if (this.options.showFriendlyErrorStack) {
      options.errorStack = new Error().stack;
    }

    return script.execute(this, args, options, callback);
  };

  this[name + 'Buffer'] = function () {
    var args = _.toArray(arguments);
    var callback;

    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    var options = { replyEncoding: null };
    if (this.options.showFriendlyErrorStack) {
      options.errorStack = new Error().stack;
    }

    return script.execute(this, args, options, callback);
  };
};


/**
 * Send a command
 *
 * @abstract
 * @public
 */
Commander.prototype.sendCommand = function () {};

function generateFunction (_commandName, _encoding) {
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

    var options = { replyEncoding: _encoding };
    if (this.options.showFriendlyErrorStack) {
      options.errorStack = new Error().stack;
    }

    var command = new Command(commandName, args, options, callback);

    return this.sendCommand(command);
  };
}

module.exports = Commander;
