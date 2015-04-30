'use strict';

var events = require('events');
var util = require('util');
var hiredis = require('hiredis');
var ReplyError = require('../reply_error');

function HiredisReplyParser(options) {
  this.options = options || {};
  this.reset();
  events.EventEmitter.call(this);
}

util.inherits(HiredisReplyParser, events.EventEmitter);

module.exports = HiredisReplyParser;

HiredisReplyParser.prototype.reset = function () {
  this.reader = new hiredis.Reader({
    return_buffers: this.options.returnBuffers || false
  });
};

HiredisReplyParser.prototype.execute = function (data) {
  var reply;
  this.reader.feed(data);
  while (true) {
    try {
      reply = this.reader.get();
    } catch (err) {
      this.emit('error', err);
      break;
    }

    if (reply === undefined) {
      break;
    }

    if (reply && reply instanceof Error) {
      this.emit('reply error', new ReplyError(reply.message));
    } else {
      this.emit('reply', reply);
    }
  }
};
