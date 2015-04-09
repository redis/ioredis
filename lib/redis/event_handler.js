var Queue = require('fastqueue');
var Command = require('../command');
var debug = require('debug')('ioredis:connection');
var _ = require('lodash');

exports.connectHandler = function (self) {
  return function () {
    debug('status: %s -> connected', self.status);
    self.status = 'connected';
    self.emit('connect');

    self.commandQueue = new Queue();

    // AUTH command should be processed before any other commands
    if (self.condition.auth) {
      self.sendCommand(new Command('auth', [self.condition.auth], 'utf8', function (err, res) {
        if (res === 'OK') {
          return;
        }
        if (err.message.match('no password is set')) {
          console.warn('`auth` is specified in the client but not in the server.');
        } else if (err) {
          self.silentEmit('error', new Error('Auth error: ' + err.message));
        } else {
          self.silentEmit('error', new Error('Auth failed: ' + res));
        }
      }));
    }

    if (!self.options.enableReadyCheck) {
      exports.readyHandler(self)();
    }

    // TODO cross file calling private method
    self._initParser();

    if (self.options.enableReadyCheck) {
      self._readyCheck(function (err, info) {
        if (err) {
          // It's likely the connection has error or is closed,
          // in both case we just emit a silent error.
          self.flushQueue(new Error("Ready check failed: " + err.message));
          self.silentEmit('error', err);
          return;
        }
        if (self.options.role && info.role && self.options.role !== info.role) {
          debug('role invalid, expected %s, but got %s', self.options.role, info.role);
          self.disconnect({ reconnect: true });
          return;
        }

        self.serverInfo = info;
        exports.readyHandler(self)();
      });
    }
  };
};

exports.closeHandler = function (self) {
  return function () {
    debug('status: %s -> closed', self.status);

    if (self.manuallyClosing) {
      self.manuallyClosing = false;
      debug('skip reconnecting since the connection is manually closed.');
      return close();
    }

    if (typeof self.options.retryStrategy !== 'function') {
      debug('skip reconnecting because `retryStrategy` is not a function');
      return close();
    }
    var retryDelay = self.options.retryStrategy(self.retryAttempts);

    if (typeof retryDelay !== 'number') {
      debug('skip reconnecting because `retryStrategy` doesn\'t return a number');
      return close();
    }

    debug('reconnect in %sms', retryDelay);

    setTimeout(function () {
      self.status = 'reconnecting';
      self.emit('reconnecting');

      self.connect();
    }, retryDelay);
  };

  function close() {
    self.status = 'closed';
    self.emit('close');
    self.flushQueue(new Error('Connection is closed.'));
  }
};

exports.dataHandler = function (self) {
  return function (data) {
    try {
      self.replyParser.execute(data);
    } catch (error) {
      // This is an unexpected parser problem, an exception that came from the parser code itself.
      // Parser should emit "error" events if it notices things are out of whack.
      // Callbacks that throw exceptions will land in return_reply(), below.
      // TODO - it might be nice to have a different "error" event for different types of errors
      self.silentEmit('error', error);
    }
  };
};

exports.errorHandler = function (self) {
  return function (error) {
    self.silentEmit('error', error);
  };
};

exports.readyHandler = function (self) {
  return function () {
    debug('status: %s -> ready', self.status);

    self.retryAttempts = 0;

    self.status = 'ready';
    self.emit('ready');

    if (self.condition.mode.monitoring) {
      self.sendCommand(new Command('monitor', null, 'utf8', function () {
        self.sendCommand = function (command) {
          command.reject(new Error('Connection is in monitoring mode, can\'t process commands.'));
          return command.promise;
        };
        self.emit('monitoring');
      }));
    } else {
      if (self.condition.select) {
        debug('connect to db [%d]', self.condition.select);
        self.sendCommand(new Command('select', [self.condition.select]));
      }
      if (self.offlineQueue.length) {
        debug('send %d commands in offline queue', self.offlineQueue.length);
        var eventualSelect = self.condition.select;
        var offlineQueue = self.offlineQueue;
        self.offlineQueue = new Queue();
        while (offlineQueue.length > 0) {
          item = offlineQueue.shift();
          if (item.select !== self.condition.select && item.command.name !== 'select') {
            self.sendCommand(new Command('select', [item.select]));
          }
          self.sendCommand(item.command, item.stream);
        }
        // TODO: hmm...
        offlineQueue = null;

        if (eventualSelect !== self.condition.select) {
          self.sendCommand(new Command('select', [eventualSelect]));
        }
      }

      if (self.condition.mode.subscriber) {
        var callback_count = 0;
        var callback = function () {
          callback_count--;
          if (callback_count === 0) {
            self.emit('ready');
          }
        };
        _.keys(self.subscription_set).forEach(function (key) {
          var parts = key.split(" ");
          if (exports.debug_mode) {
            console.warn("sending pub/sub on_ready " + parts[0] + ", " + parts[1]);
          }
          callback_count++;
          self.send_command(parts[0] + "scribe", [parts[1]], callback);
        });
      }
    }
  };
};
