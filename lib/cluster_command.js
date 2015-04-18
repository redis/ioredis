var Promise = require('bluebird');
var Command = require('./command');
var util = require('util');
var utils = require('./utils');

function ClusterCommand (command, callback) {
  this.name = command.name;

  this.args = command.args;
  this.command = command;

  var key = this.args[0];
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
