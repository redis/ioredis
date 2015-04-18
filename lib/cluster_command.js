var Promise = require('bluebird');
var Command = require('./command');
var util = require('util');
var utils = require('./utils');

function ClusterCommand (command, callback) {
  this.name = command.name;

  this.args = command.args;
  this.command = command;

  // TODO calc slot
  var key = this.args[0];
  if (key) {
    var s = key.indexOf('{');
    if (s !== -1) {
      var e = key.indexOf('}', s + 2);
      if (e !== -1) {
        key = key.slice(s + 1, e - 1);
      }
    }
    this.slot = utils.crc16(key) % 16384;
  }

  var _this = this;
  this.promise = new Promise(function (resolve, reject) {
    _this.resolve = resolve;
    _this.reject = reject;
  }).nodeify(callback);
}

util.inherits(ClusterCommand, Command);

module.exports = ClusterCommand;
