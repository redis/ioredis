'use strict';

var debug = require('debug')('ioredis:connection');

exports.connectHandler = function (self) {
  return function () {
    debug('status: %s -> connect', self.status);
    self.status = 'connect';

    self.commandQueue = [];

    // AUTH command should be processed before any other commands
    if (self.condition.auth) {
      self.auth(self.condition.auth, function (err, res) {
        if (err && err.message.match('no password is set')) {
          console.warn('`auth` is specified in the client but not in the server.');
        }
      });
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
    debug('status: %s -> end', self.status);
    self.status = 'end';

    self.prevCondition = self.condition;

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

    setTimeout(function () {
      self.connect();
    }, retryDelay);
  };

  function close() {
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
    debug('status: %s -> ready', self.status);
    self.status = 'ready';
    self.retryAttempts = 0;

    var finalSelect = self.condition.select;
    self.condition.select = 0;
    if (self.offlineQueue.length) {
      debug('send %d commands in offline queue', self.offlineQueue.length);
      var offlineQueue = self.offlineQueue;
      self.offlineQueue = [];
      while (offlineQueue.length > 0) {
        var item = offlineQueue.shift();
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

    if (self.prevCondition) {
      var condition = self.prevCondition;
      if (condition.mode.monitoring) {
        self.call('monitor', function () {
          self.sendCommand = function (command) {
            command.reject(new Error('Connection is in monitoring mode, can\'t process commands.'));
            return command.promise;
          };
          self.emit('monitoring');
        });
      } else {
        if (condition.mode.subscriber && self.options.autoResubscribe) {
          var subscribeChannels = condition.mode.subscriber.channels('subscribe');
          if (subscribeChannels.length) {
            debug('subscribe %d channels', subscribeChannels.length);
            self.subscribe(subscribeChannels);
          }
          var psubscribeChannels = condition.mode.subscriber.channels('psubscribe');
          if (psubscribeChannels.length) {
            debug('psubscribe %d channels', psubscribeChannels.length);
            self.psubscribe(psubscribeChannels);
          }
        }
      }
    }
  };
};
