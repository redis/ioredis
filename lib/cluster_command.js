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
    case 'sort':
      keys.push(this.args[0]);
      for (i = 1; i < this.args.length - 1; ++i) {
        if (typeof this.args[i] !== 'string') {
          continue;
        }
        var directive = this.args[i].toUpperCase();
        if (directive === 'GET') {
          i += 1;
          if (this.args[i] !== '#') {
            keys.push(this.getKeyPart(this.args[i]));
          }
        } else if (directive === 'BY') {
          i += 1;
          keys.push(this.getKeyPart(this.args[i]));
        } else if (directive === 'STORE') {
          i += 1;
          keys.push(this.args[i]);
        }
      }
      break;
    case 'zunionstore':
    case 'zinterstore':
      keys.push(this.args[0]);
      keyStop = parseInt(this.args[1], 10) + 2;
      for (i = 2; i < keyStop; ++i) {
        keys.push(this.args[i]);
      }
      break;
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

ClusterCommand.prototype.getKeyPart = function (key) {
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



module.exports = ClusterCommand;
