var Promise = require('bluebird');
var Command = require('./command');
var util = require('util');
var utils = require('./utils');
var commands = require('ioredis-commands');

function ClusterCommand (command, callback) {
  this.name = command.name;

  this.args = command.args;
  this.command = command;

  // get first key
  var key;
  var def = commands[this.name];
  if (def) {
    var keyPosition = def.keyStart - 1;
    if (keyPosition >= 0 && keyPosition < this.args.length) {
      key = this.args[keyPosition];
    }
  }
  if (key) {
    this.slot = utils.calcSlot(key);
  }

  var _this = this;
  this.promise = new Promise(function (resolve, reject) {
    _this.resolve = resolve;
    _this.reject = reject;
  }).nodeify(callback);
}

util.inherits(ClusterCommand, Command);

module.exports = ClusterCommand;
