'use strict';

var Command = require('./command');
var crypto = require('crypto');
var Promise = require('bluebird');

function Script(lua, numberOfKeys, keyPrefix) {
  this.lua = lua;
  this.sha = crypto.createHash('sha1').update(this.lua).digest('hex');
  this.numberOfKeys = typeof numberOfKeys === 'number' ? numberOfKeys : null;
  this.keyPrefix = keyPrefix ? keyPrefix : '';
}

Script.prototype.execute = function (container, args, options, callback) {
  if (typeof this.numberOfKeys === 'number') {
    args.unshift(this.numberOfKeys);
  }
  if (this.keyPrefix) {
    options.keyPrefix = this.keyPrefix;
  }

  var evalsha = new Command('evalsha', [this.sha].concat(args), options);
  evalsha.isCustomCommand = true;
  var result = container.sendCommand(evalsha);
  if (result instanceof Promise) {
    var _this = this;
    return result.catch(function (err) {
      if (err.toString().indexOf('NOSCRIPT') === -1) {
        throw err;
      }
      return container.sendCommand(new Command('eval', [_this.lua].concat(args), options));
    }).nodeify(callback);
  }

  // result is not a Promise--probably returned from a pipeline chain; however,
  // we still need the callback to fire when the script is evaluated
  evalsha.promise.nodeify(callback);

  return result;
};

module.exports = Script;
