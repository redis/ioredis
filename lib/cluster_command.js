'use strict';

var Promise = require('bluebird');
var Command = require('./command');
var util = require('util');
var utils = require('./utils');

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
