'use strict';

var Promise = require('bluebird');
var Command = require('./command');
var util = require('util');
var utils = require('./utils');
var commands = require('ioredis-commands');

function ClusterCommand (command, callback) {
  this.name = command.name;

  this.args = command.args;
  this.command = command;

  this.keys = this.getKeys();

  // Use the first key to calc slot
  var key = this.keys[0];
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

ClusterCommand.prototype.getKeys = function () {
  var keys = [];
  var i, keyStart, keyStop;
  var def = commands[this.name];
  if (def) {
    switch (this.name) {
    case 'eval':
    case 'evalsha':
      keyStop = parseInt(this.args[1], 10) + 2;
      for (i = 2; i < keyStop; ++i) {
        keys.push(this.args[i]);
      }
      break;
    // TODO
    // case 'sort':
    // case 'zunionstore':
    // case 'zinterstore':
    default:
      keyStart = def.keyStart - 1;
      keyStop = def.keyStop > 0 ? def.keyStop : this.args.length + def.keyStop + 1;
      for (i = keyStart; i < keyStop; i += def.step) {
        keys.push(this.args[i]);
      }
      break;
    }
  }
  return keys;
};

module.exports = ClusterCommand;
