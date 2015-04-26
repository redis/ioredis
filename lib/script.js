var Command = require('./command');
var crypto = require('crypto');
var Promise = require('bluebird');

function Script(lua, numberOfKeys) {
  this.lua = lua;
  this.sha = crypto.createHash('sha1').update(this.lua).digest('hex');
  this.numberOfKeys = typeof numberOfKeys === 'number' ? numberOfKeys : null;
}

Script.prototype.execute = function (container, args, options, callback) {
  if (this.numberOfKeys) {
    args.unshift(this.numberOfKeys);
  }

  var result = container.sendCommand(new Command('evalsha', [this.sha].concat(args), options));
  if (result instanceof Promise) {
    var _this = this;
    return result.catch(function (err) {
      if (err.toString().indexOf('NOSCRIPT') === -1) {
        throw err;
      }
      return container.sendCommand(new Command('eval', [_this.lua].concat(args), options));
    }).nodeify(callback);
  }

  return result;
};

module.exports = Script;
