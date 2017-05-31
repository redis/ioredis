'use strict';

var util = require('util');

function ReplyError(message) {
  this.name = this.constructor.name;
  this.message = message || '';

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, this.constructor);
  }
};

util.inherits(ReplyError, Error);

module.exports = ReplyError;
