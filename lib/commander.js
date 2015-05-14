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
    string: function () {
      var args = _.toArray(arguments);
      var callback;

      if (typeof args[args.length - 1] === 'function') {
        callback = args.pop();
      }

      var options = { replyEncoding: 'utf8' };
      if (this.options.showFriendlyErrorStack) {
        options.errorStack = new Error().stack;
      }

      var command = new Command(commandName, args, options, callback);

      return this.sendCommand(command);
    },
    buffer: function () {
      var args = _.toArray(arguments);
      var callback;

      if (typeof args[args.length - 1] === 'function') {
        callback = args.pop();
      }

      var options = { replyEncoding: null };
      if (this.options.showFriendlyErrorStack) {
        options.errorStack = new Error().stack;
      }
      var command = new Command(commandName, args, options, callback);

      return this.sendCommand(command);
    }
  };
};

_.forEach(commands, function (commandName) {
  var methods = Commander.prototype.createBuiltinCommand(commandName);
  Commander.prototype[commandName] = methods.string;
  Commander.prototype[commandName + 'Buffer'] = methods.buffer;
});

Commander.prototype.call = function () {
  var args = _.toArray(arguments);
  var commandName = args.shift();
  var callback;

  if (typeof args[args.length - 1] === 'function') {
    callback = args.pop();
  }

  var options = { replyEncoding: 'utf8' };
  if (this.options && this.options.showFriendlyErrorStack) {
    options.errorStack = new Error().stack;
  }
  var command = new Command(commandName, args, options, callback);

  return this.sendCommand(command);
};

Commander.prototype.callBuffer = function () {
  var args = _.toArray(arguments);
  var commandName = args.shift();
  var callback;

  if (typeof args[args.length - 1] === 'function') {
    callback = args.pop();
  }

  var options = { replyEncoding: null };
  if (this.options && this.options.showFriendlyErrorStack) {
    options.errorStack = new Error().stack;
  }
  var command = new Command(commandName, args, options, callback);

  return this.sendCommand(command);
};

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


Commander.prototype.sendCommand = function () {};

module.exports = Commander;
