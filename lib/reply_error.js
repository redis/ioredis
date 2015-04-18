var util = require('util');

function ReplyError(message) {
  Error.call(this);
  Error.captureStackTrace(this, this.constructor);

  this.name = this.constructor.name;
  this.message = message;
}

// inherit from Error
util.inherits(ReplyError, Error);

module.exports = ReplyError;
