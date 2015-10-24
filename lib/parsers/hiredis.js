'use strict';

var hiredis = require('hiredis');
var ReplyError = require('../reply_error');

function HiredisReplyParser(options) {
  this.options = options || {};
  this.reset();
}

module.exports = HiredisReplyParser;

HiredisReplyParser.prototype.reset = function () {
  this.reader = new hiredis.Reader({
    return_buffers: true
  });
};

HiredisReplyParser.prototype.execute = function (data) {
  var reply;
  this.reader.feed(data);
  while (true) {
    try {
      reply = this.reader.get();
    } catch (err) {
      this.sendFatalError(err);
      break;
    }

    if (reply === undefined) {
      break;
    }

    if (reply && reply instanceof Error) {
      this.sendError(new ReplyError(reply.message));
    } else {
      this.sendReply(reply);
    }
  }
};
