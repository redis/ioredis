var _ = require('lodash');
var Command = require('../../../command');
var Promise = require('bluebird');

var commands = require('ioredis-commands');
var skippedCommands = ['monitor'];
_.keys(commands).forEach(function (command) {
  if (_.includes(skippedCommands, command)) {
    return;
  }
  command = command.toLowerCase();
  exports[command] = function () {
    var args = _.toArray(arguments);
    var callback;

    // If the last argument is a callback function
    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    return this.sendCommand(new Command(command, args, 'utf8', callback));
  };

  exports[command + 'Buffer'] = function () {
    var args = _.toArray(arguments);
    var callback;

    // If the last argument is a callback function
    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    return this.sendCommand(new Command(command, args, null, callback));
  };
});

/**
 * Listen for all requests received by the server in real time.
 *
 * This command will create a new connection to Redis and send a
 * MONITOR command via the new connection in order to avoid disturbing
 * the current connection.
 *
 * @param {function} [callback] The callback function. If omit, a promise will be returned.
 * @example
 * var redis = new Redis();
 * redis.monitor(function (err, monitor) {
 *   // Entering monitoring mode.
 *   monitor.on('monitor', function (time, args) {
 *     console.log(time + ": " + util.inspect(args));
 *   });
 * });
 *
 * // supports promise as well as other commands
 * redis.monitor().then(function (monitor) {
 *   monitor.on('monitor', function (time, args) {
 *     console.log(time + ": " + util.inspect(args));
 *   });
 * });
 * @public
 */
exports.monitor = function (callback) {
  var monitorInstance = this.duplicate();
  monitorInstance.options.enableReadyCheck = false;
  monitorInstance.condition.mode.monitoring = true;

  return new Promise(function (resolve, reject) {
    monitorInstance.once('monitoring', function () {
      resolve(monitorInstance);
    });
  }).nodeify(callback);
};

/**
 * Send a command to Redis
 *
 * This method is used internally by the `Redis#set`, `Redis#lpush` etc.
 * Most of the time you won't invoke this method directly.
 * However when you want to send a command that is not supported by ioredis yet,
 * this command will be useful.
 *
 * @method sendCommand
 * @memberOf Redis#
 * @param {Command} command - The Command instance to send.
 * @see {@link Command}
 * @example
 * var redis = new Redis();
 *
 * // Use callback
 * var get = new Command('get', ['foo'], 'utf8', function (err, result) {
 *   console.log(result);
 * });
 * redis.sendCommand(get);
 *
 * // Use promise
 * var set = new Command('set', ['foo', 'bar'], 'utf8');
 * set.promise.then(function (result) {
 *   console.log(result);
 * });
 * redis.sendCommand(set);
 * @public
 */
exports.sendCommand = function (command) {
  if (this.condition.mode.subscriber && !_.includes(Command.FLAGS.VALID_IN_SUBSCRIBER_MODE, command.name)) {
    command.reject(new Error('Connection in subscriber mode, only subscriber commands may be used'));
    return command.promise;
  }

  var writable = (this.status === 'ready') || ((this.status === 'connected') &&  _.includes(Command.FLAGS.VALID_WHEN_LOADING, command.name));
  if (writable) {
    this.connection.write(command.toWritable());

    // Subscribe commands are special
    var isSubscribeCommand = _.includes(Command.FLAGS.ENTER_SUBSCRIBER_MODE, command.name);
    var isUnsubscribeCommand = !isSubscribeCommand && _.includes(Command.FLAGS.EXIT_SUBSCRIBER_MODE, command.name);
    if (isSubscribeCommand || isUnsubscribeCommand) {
      if (isSubscribeCommand && !this.condition.mode.subscriber) {
        this.condition.mode.subscriber = true;
      }
      var channels = command.args;
      if (isUnsubscribeCommand && channels.length === 0) {
        channels = this.subscriptionSet.channels(command.name);
      }
      command.remainReplies = channels.length;
      for (var i = 0; i < channels.length; ++i) {
        var channel = channels[i];
        if (isSubscribeCommand) {
          this.subscriptionSet.add(command.name, channel);
        } else {
          this.subscriptionSet.del(command.name, channel);
        }
        this.subscriptionQueue.push(command.name, channel, command);
      }
    } else {
      this.commandQueue.push(command);
    }

    if (_.includes(Command.FLAGS.WILL_DISCONNECT, command.name)) {
      this.manuallyClosing = true;
    }
  } else if (this.options.enableOfflineQueue) {
    this.offlineQueue.push(command);
  } else {
    command.reject(new Error('Stream isn\'t writeable and enableOfflineQueue options is false'));
  }

  return command.promise;
};
