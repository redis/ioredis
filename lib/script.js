'use strict';

var Command = require('./command');
var crypto = require('crypto');
var PromiseContainer = require('./promiseContainer')
var asCallback = require('standard-as-callback');

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
  if (PromiseContainer.isPromise(result)) {
    var _this = this;
    return asCallback(
      result.catch(function (err) {
        if (err.toString().indexOf('NOSCRIPT') === -1) {
          throw err;
        }
        return container.sendCommand(
          new Command('eval', [_this.lua].concat(args), options)
        );
      }),
      callback
    )
  }

  // result is not a Promise--probably returned from a pipeline chain; however,
  // we still need the callback to fire when the script is evaluated
  asCallback(evalsha.promise, callback)

  return result;
};

module.exports = Script;
