var Command = require('./command');

function Script(lua, numberOfKeys) {
  this.lua = lua;
  this.numberOfKeys = typeof numberOfKeys === 'number' ? numberOfKeys : null;
  this.sha1 = null;
}

Script.prototype.getExecuteCommand = function (args, replyEncoding, callback) {
  var numberOfKeys = this.numberOfKeys;
  if (numberOfKeys === null) {
    numberOfKeys = args.shift();
  }
  if (typeof numberOfKeys !== 'number') {
    throw new Error('`numberOfKeys` is not defined');
  }
  var command;
  if (!this.sha1) {
    command = new Command('eval', [this.lua, numberOfKeys].concat(args), replyEncoding, callback);
  } else {
    command = new Command('evalsha', [this.sha1, numberOfKeys].concat(args), replyEncoding, callback);
  }

  return command;
};

Script.prototype.getLoadCommand = function () {
  var _this = this;
  var command = new Command('script load', null, 'utf8', function (err, sha1) {
    _this.sha1 = sha1;
  });
  return command;
};

module.exports = Script;
