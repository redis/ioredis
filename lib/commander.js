var _ = require('lodash');
var Command = require('./command');

function Commander () {}

var commands = _.difference(_.uniq(_.keys(require('ioredis-commands')).map(function (commandName) {
  return commandName.split(' ')[0].toLowerCase();
})), ['monitor']);

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

Commander.prototype.sendCommand = function () {};

module.exports = Commander;
