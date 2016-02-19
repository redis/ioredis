'use strict';

var debug = require('debug')('ioredis:connection');
var Command = require('../command');
var _ = require('lodash');

exports.connectHandler = function (self) {
  return function () {
    self.setStatus('connect');

    self.resetCommandQueue();

    // AUTH command should be processed before any other commands
    if (self.condition.auth) {
      self.auth(self.condition.auth, function (err) {
        if (err) {
          self.emit('authError', err);
        }
      });
    }

    if (self.condition.select) {
      self.selectBuffer(self.condition.select);
    }

    if (!self.options.enableReadyCheck) {
      exports.readyHandler(self)();
    }

    self.initParser();

    if (self.options.enableReadyCheck) {
      self._readyCheck(function (err, info) {
        if (err) {
          self.flushQueue(new Error('Ready check failed: ' + err.message));
        } else {
          self.serverInfo = info;
          if (self.connector.check(info)) {
            exports.readyHandler(self)();
          } else {
            self.disconnect(true);
          }
        }
      });
    }
  };
};

exports.closeHandler = function (self) {
  return function () {
    self.setStatus('close');

    if (!self.prevCondition) {
      self.prevCondition = self.condition;
    }
    if (self.commandQueue.length) {
      self.prevCommandQueue = self.commandQueue;
    }

    if (self.manuallyClosing) {
      self.manuallyClosing = false;
      debug('skip reconnecting since the connection is manually closed.');
      return close();
    }

    if (typeof self.options.retryStrategy !== 'function') {
      debug('skip reconnecting because `retryStrategy` is not a function');
      return close();
    }
    var retryDelay = self.options.retryStrategy(++self.retryAttempts);

    if (typeof retryDelay !== 'number') {
      debug('skip reconnecting because `retryStrategy` doesn\'t return a number');
      return close();
    }

    debug('reconnect in %sms', retryDelay);

    self.setStatus('reconnecting', retryDelay);
    self.reconnectTimeout = setTimeout(function () {
      self.reconnectTimeout = null;
      self.connect().catch(function () {});
    }, retryDelay);
  };

  function close() {
    self.setStatus('end');
    self.flushQueue(new Error('Connection is closed.'));
  }
};

exports.dataHandler = function (self) {
  return function (data) {
    self.replyParser.execute(data);
  };
};

exports.errorHandler = function (self) {
  return function (error) {
    debug('error: %s', error);
    self.silentEmit('error', error);
  };
};

exports.readyHandler = function (self) {
  return function () {
    self.setStatus('ready');
    self.retryAttempts = 0;

    if (self.options.monitor) {
      self.call('monitor');
      var sendCommand = self.sendCommand;
      self.sendCommand = function (command) {
        if (_.includes(Command.FLAGS.VALID_IN_MONITOR_MODE, command.name)) {
          return sendCommand.call(self, command);
        }
        command.reject(new Error('Connection is in monitoring mode, can\'t process commands.'));
        return command.promise;
      };
      self.once('close', function () {
        delete self.sendCommand;
      });
      self.setStatus('monitoring');
      return;
    }
    var item;
    var finalSelect = self.prevCondition ? self.prevCondition.select : self.condition.select;

    if (self.options.connectionName) {
      debug('set the connection mane [%s]', self.options.connectionName);
      self.client('setname', self.options.connectionName);
    }

    if (self.prevCondition) {
      var condition = self.prevCondition;
      self.prevCondition = null;
      if (condition.subscriber && self.options.autoResubscribe) {
        // We re-select the previous db first since
        // `SELECT` command is not valid in sub mode.
        if (self.condition.select !== finalSelect) {
          debug('connect to db [%d]', finalSelect);
          self.selectBuffer(finalSelect);
        }
        var subscribeChannels = condition.subscriber.channels('subscribe');
        if (subscribeChannels.length) {
          debug('subscribe %d channels', subscribeChannels.length);
          self.subscribe(subscribeChannels);
        }
        var psubscribeChannels = condition.subscriber.channels('psubscribe');
        if (psubscribeChannels.length) {
          debug('psubscribe %d channels', psubscribeChannels.length);
          self.psubscribe(psubscribeChannels);
        }
      }
    }

    if (self.prevCommandQueue) {
      if (self.options.autoResendUnfulfilledCommands) {
        debug('resend %d unfulfilled commands', self.prevCommandQueue.length);
        while (self.prevCommandQueue.length > 0) {
          item = self.prevCommandQueue.shift();
          if (item.select !== self.condition.select && item.command.name !== 'select') {
            self.select(item.select);
          }
          self.sendCommand(item.command, item.stream);
        }
      } else {
        self.prevCommandQueue = null;
      }
    }

    if (self.offlineQueue.length) {
      debug('send %d commands in offline queue', self.offlineQueue.length);
      var offlineQueue = self.offlineQueue;
      self.resetOfflineQueue();
      while (offlineQueue.length > 0) {
        item = offlineQueue.shift();
        if (item.select !== self.condition.select && item.command.name !== 'select') {
          self.select(item.select);
        }
        self.sendCommand(item.command, item.stream);
      }
    }

    if (self.condition.select !== finalSelect) {
      debug('connect to db [%d]', finalSelect);
      self.selectBuffer(finalSelect);
    }
  };
};
