var _ = require('lodash');
var Queue = require('fastqueue');
var utils = require('../../utils');

/**
 * Init the parser
 *
 * @method _initParser
 * @memberOf Redis#
 * @private
 */
exports._initParser = function () {
  var self = this;

  this.replyParser = new this.parser.Parser({
    return_buffers: true
  });

  // "reply error" is an error sent back by Redis
  this.replyParser.on('reply error', function (reply) {
    process.nextTick(function () {
      self.returnError(reply);
    });
  });
  this.replyParser.on('reply', function (reply) {
    // Prevent the exception be caught by the parser.
    process.nextTick(function () {
      self.returnReply(reply);
    });
  });
  // "error" is bad.  Somehow the parser got confused.  It'll try to reset and continue.
  this.replyParser.on('error', function (err) {
    self.emit('error', new Error('Redis reply parser error: ' + err.stack));
  });
};

exports.returnError = function (err) {
  var command = this.commandQueue.shift();

  if (this.commandQueue.length === 0) {
    this.commandQueue = new Queue();
  }

  command.reject(err);
};

var sharedBuffers = {};
_.forEach(['message', 'pmessage', 'subscribe', 'psubscribe', 'unsubscribe', 'punsubscribe'], function (str) {
  sharedBuffers[str] = new Buffer(str);
});
exports.returnReply = function (reply) {
  if (this.condition.mode.monitoring) {
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
      this.emit('monitor', timestamp, args);
      return;
    }
  }

  var associatedCommand = this.commandQueue.shift();
  if (this.commandQueue.length === 0) {
    this.commandQueue = new Queue();
  }

  if (this.condition.mode.subscriber && !associatedCommand) {
    // If the reply is a message/pmessage,
    // then just emit it instead of considering it as a reply
    var replyType = Array.isArray(reply) ? reply[0].toString() : null;
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
      case 'unsubscribe':
      case 'punsubscribe':
        var channel = reply[1].toString();
        var count = reply[2];
        if (count === 0) {
          this.condition.mode.subscriber = false;
        }
        var command = this.subscriptionQueue.shift(replyType, channel);
        if (command) {
          command.remainReplies -= 1;
          if (command.remainReplies === 0) {
            command.resolve(count);
          }
        }
        break;
      default:
        this.emit('error', new Error('Subscription queue state error. If you can reproduce this, please report it.'));
    }
  } else if (associatedCommand) {
    associatedCommand.resolve(reply);
  } else {
    this.emit('error', new Error('Command queue state error. If you can reproduce this, please report it.'));
  }
};
