var _ = require('lodash');
var Command = require('./command');

function Commander () {}

var commands = _.difference(_.keys(require('ioredis-commands'), ['monitor']));

commands.push('sentinel', 'quit');

_.forEach(commands, function (commandName) {
  Commander.prototype[commandName] = function () {
    var args = _.toArray(arguments);
    var callback;

    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    return this.sendCommand(new Command(commandName, args, 'utf8', callback));
  };

  Commander.prototype[commandName + 'Buffer'] = function () {
    var args = _.toArray(arguments);
    var callback;

    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    return this.sendCommand(new Command(commandName, args, null, callback));
  };
});

Commander.prototype.call = function () {
  var args = _.toArray(arguments);
  var commandName = args.shift();
  var callback;

  if (typeof args[args.length - 1] === 'function') {
    callback = args.pop();
  }

  return this.sendCommand(new Command(commandName, args, 'utf8', callback));
};

Commander.prototype.callBuffer = function () {
  var args = _.toArray(arguments);
  var commandName = args.shift();
  var callback;

  if (typeof args[args.length - 1] === 'function') {
    callback = args.pop();
  }

  return this.sendCommand(new Command(commandName, args, null, callback));
};

Commander.prototype.sendCommand = function () {};

module.exports = Commander;
