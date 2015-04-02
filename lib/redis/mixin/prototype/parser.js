var _ = require('lodash');
var Queue = require('fastqueue');
var utils = require('../../../utils');

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
    if (reply instanceof Error) {
      self.returnError(reply);
    } else {
      self.returnError(new Error(reply));
    }
  });
  this.replyParser.on('reply', function (reply) {
    self.returnReply(reply);
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

  var replyType = Array.isArray(reply) ? reply[0] : null;

  if (this.condition.mode.subscriber) {
    // If the reply is a message/pmessage,
    // then just emit it instead of considering it as a reply

    // TODO current we assume chennel name is a utf8 string, which may be incorrect.
    if (utils.bufferEqual(sharedBuffers.message, replyType)) {
      this.emit('message', reply[1].toString(), reply[2]); // channel, message
      return;
    }
    if (utils.bufferEqual(sharedBuffers.pmessage, replyType)) {
      this.emit('pmessage', reply[1].toString(), reply[2].toString(), reply[3]); // pattern, channel, message
      return;
    }
    // Some commands still valid in the subscriber mode(like unsubscribe, ping, quit etc).
    // So we don't return here.
  }

  var associatedCommand = this.commandQueue.shift();
  if (!associatedCommand) {
    this.emit('error', new Error('ioRedis command queue state error. If you can reproduce this, please report it.'));
    return;
  }

  if (this.commandQueue.length === 0) {
    this.commandQueue = new Queue();
  }

  associatedCommand.resolve(reply);

  if (replyType) {
    _(['subscribe', 'unsubscribe', 'psubscribe', 'punsubscribe']).some(function (type) {
      if (utils.bufferEqual(sharedBuffers[type], replyType)) {
        // TODO support binary channel name
        var channel = reply[1].toString();
        var count = reply[2];
        if (count === 0) {
          this.condition.mode.subscriber = false;
          debug('All subscriptions removed, exiting pub/sub mode');
        } else {
          this.condition.mode.subscriber = true;
        }
        this.emit(type, channel, count);

        return true;
      }
    });
  }
};

