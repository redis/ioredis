'use strict';

var _ = require('lodash');
var Command = require('./command');
var Script = require('./script');

function Commander() {
  this.options = _.defaults(this.options || {}, {
    showFriendlyErrorStack: false
  });
  this.scriptsSet = {};
}

var commands = _.difference(_.keys(require('ioredis-commands'), ['monitor']));

commands.push('sentinel', 'quit');

_.forEach(commands, function (commandName) {
  Commander.prototype[commandName] = function () {
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
  };

  Commander.prototype[commandName + 'Buffer'] = function () {
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
  };
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
