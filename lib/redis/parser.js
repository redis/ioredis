'use strict';

var _ = require('lodash');
var Command = require('../command');
var SubscriptionSet = require('../subscription_set');
var debug = require('debug')('ioredis:reply');
var Parser = require('redis-parser');
var ReplyError = require('../reply_error');

/**
 * Init the parser
 *
 * @method _initParser
 * @memberOf Redis#
 * @private
 */
exports.initParser = function () {
  var _this = this;

  this.replyParser = new Parser({
    name: this.options.parser,
    stringNumbers: this.options.stringNumbers,
    returnBuffers: !this.options.dropBufferSupport,
    returnError: function (err) {
      _this.returnError(new ReplyError(err.message));
    },
    returnReply: function (reply) {
      _this.returnReply(reply);
    },
    returnFatalError: function (err) {
      _this.flushQueue(err, { offlineQueue: false });
      _this.silentEmit('error', new Error('Redis parser fatal error: ' + err.stack));
      _this.disconnect(true);
    }
  });

  if (this.replyParser.name === 'hiredis' && !this.options.dropBufferSupport) {
    console.warn('[WARN] ioredis is using hiredis parser, however "dropBufferSupport" is disabled. ' +
     'It\'s highly recommanded to enable this option. ' +
     'Refer to https://github.com/luin/ioredis/wiki/Improve-Performance for more details.');
  }
};

exports.returnError = function (err) {
  var item = this.commandQueue.shift();

  err.command = {
    name: item.command.name,
    args: item.command.args
  };

  var needReconnect = false;
  if (this.options.reconnectOnError) {
    needReconnect = this.options.reconnectOnError(err);
  }

  switch (needReconnect) {
  case 1:
  case true:
    if (this.status !== 'reconnecting') {
      this.disconnect(true);
    }
    item.command.reject(err);
    break;
  case 2:
    if (this.status !== 'reconnecting') {
      this.disconnect(true);
    }
    if (this.condition.select !== item.select && item.command.name !== 'select') {
      this.select(item.select);
    }
    this.sendCommand(item.command);
    break;
  default:
    item.command.reject(err);
  }
};

var sharedBuffers = {};
_.forEach(['message', 'pmessage', 'subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe'], function (str) {
  sharedBuffers[str] = new Buffer(str);
});
exports.returnReply = function (reply) {
  if (this.status === 'monitoring') {
    // Valid commands in the monitoring mode are AUTH and MONITOR,
    // both of which always reply with 'OK'.
    var replyStr = reply.toString();

    // If not the reply to AUTH & MONITOR
    if (replyStr !== 'OK') {
      // Since commands sent in the monitoring mode will trigger an exception,
      // any replies we received in the monitoring mode should consider to be
      // realtime monitor data instead of result of commands.
      var len = replyStr.indexOf(' ');
      var timestamp = replyStr.slice(0, len);
      var argindex = replyStr.indexOf('"');
      var args = replyStr.slice(argindex + 1, -1).split('" "').map(function (elem) {
        return elem.replace(/\\"/g, '"');
      });
      var dbAndSource = replyStr.slice(len + 2, argindex - 2).split(' ');
      this.emit('monitor', timestamp, args, dbAndSource[1], dbAndSource[0]);
      return;
    }
  }

  var item, channel, count;
  if (this.condition.subscriber) {
    var replyType = Array.isArray(reply) ? reply[0].toString() : null;
    debug('receive reply "%s" in subscriber mode', replyType);

    switch (replyType) {
    case 'message':
      if (this.listeners('message').length > 0) {
        this.emit('message', reply[1].toString(), reply[2].toString());
      }
      if (this.listeners('messageBuffer').length > 0) {
        this.emit('messageBuffer', reply[1], reply[2]);
      }
      break;
    case 'pmessage':
      var pattern = reply[1].toString();
      if (this.listeners('pmessage').length > 0) {
        this.emit('pmessage', pattern, reply[2].toString(), reply[3].toString());
      }
      if (this.listeners('pmessageBuffer').length > 0) {
        this.emit('pmessageBuffer', pattern, reply[2], reply[3]);
      }
      break;
    case 'subscribe':
    case 'psubscribe':
      channel = reply[1].toString();
      this.condition.subscriber.add(replyType, channel);
      item = this.commandQueue.shift();
      if (!fillSubCommand(item.command, reply[2])) {
        this.commandQueue.unshift(item);
      }
      break;
    case 'unsubscribe':
    case 'punsubscribe':
      channel = reply[1] ? reply[1].toString() : null;
      if (channel) {
        this.condition.subscriber.del(replyType, channel);
      }
      count = reply[2];
      if (count === 0) {
        this.condition.subscriber = false;
      }
      item = this.commandQueue.shift();
      if (!fillUnsubCommand(item.command, count)) {
        this.commandQueue.unshift(item);
      }
      break;
    default:
      item = this.commandQueue.shift();
      item.command.resolve(reply);
    }
  } else {
    item = this.commandQueue.shift();
    if (!item) {
      return this.emit('error',
        new Error('Command queue state error. If you can reproduce this, please report it. Last reply: ' +
          reply.toString()));
    }
    if (Command.checkFlag('ENTER_SUBSCRIBER_MODE', item.command.name)) {
      this.condition.subscriber = new SubscriptionSet();
      this.condition.subscriber.add(item.command.name, reply[1].toString());

      if (!fillSubCommand(item.command, reply[2])) {
        this.commandQueue.unshift(item);
      }
    } else if (Command.checkFlag('EXIT_SUBSCRIBER_MODE', item.command.name)) {
      if (!fillUnsubCommand(item.command, reply[2])) {
        this.commandQueue.unshift(item);
      }
    } else {
      item.command.resolve(reply);
    }
  }

  function fillSubCommand(command, count) {
    if (typeof command.remainReplies === 'undefined') {
      command.remainReplies = command.args.length;
    }
    if (--command.remainReplies === 0) {
      command.resolve(count);
      return true;
    }
    return false;
  }

  function fillUnsubCommand(command, count) {
    if (typeof command.remainReplies === 'undefined') {
      command.remainReplies = command.args.length;
    }
    if (command.remainReplies === 0) {
      if (count === 0) {
        command.resolve(reply[2]);
        return true;
      }
      return false;
    }
    if (--command.remainReplies === 0) {
      command.resolve(reply[2]);
      return true;
    }
    return false;
  }
};
