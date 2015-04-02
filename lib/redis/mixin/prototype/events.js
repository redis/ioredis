var Queue = require('fastqueue');
var Command = require('../../../command');
var debug = require('debug')('ioredis');

exports.initConnection = function (connection) {
  connection.once('connect', connectHandler(this));
  connection.once('error', errorHandler(this));
  connection.once('close', closeHandler(this));
  connection.on('data', dataHandler(this));

  this.connection = connection;
};

function connectHandler(self) {
  return function () {
    debug('status: %s -> connected', self.status);
    self.status = 'connected';
    self.emit('connect');

    self.commandQueue = new Queue();
    self.retryAttempts = 0;

    // AUTH command should be processed before any other commands
    if (self.condition.auth) {
      console.log(self.condition.auth);
      self.sendCommand(new Command('auth', [self.condition.auth], 'utf8', function (err, res) {
        console.log('auth', err, res);
        if (res === 'OK') {
          return;
        }
        if (err.message.match('no password is set')) {
          debug('`auth` is specified in the client but not in the server.');
        } else if (err) {
          self.silentEmit('error', new Error('Auth error: ' + err.message));
        } else {
          self.silentEmit('error', new Error('Auth failed: ' + res));
        }
      }));
    }
    if (self.condition.select) {
      self.sendCommand(new Command('select', [self.condition.select]));
    }

    if (!self.options.enableReadyCheck) {
      readyHandler(self)();
    }

    // TODO cross file calling private method
    self._initParser();

    if (self.options.enableReadyCheck) {
      self._readyCheck(function (err, info) {
        if (err) {
          // It's likely the connection has error or is closed,
          // in both case we just emit a silent error.
          return self.silentEmit('error', err);
        }
        self.serverInfo = info;
        readyHandler(self)();
      });
    }
  };
}

function closeHandler(self) {
  return function () {
    debug('status: %s -> close', self.status);

    self.status = 'closed';
    self.emit('close');

    self.flushQueue(new Error('Connection is closed.'));

    if (self.manuallyClosing) {
      self.manuallyClosing = false;
      debug('skip reconnecting since the connection is manually closed.');
      return;
    }

    self.retryAttempts += 1;

    if (typeof self.options.retryStrategy !== 'function') {
      debug('skip reconnecting because `retryStrategy` is not a function');
      return;
    }
    var retryDelay = self.options.retryStrategy(self.retryAttempts);

    if (typeof retryDelay !== 'number') {
      debug('skip reconnecting because `retryStrategy` doesn\'t return a number');
      return;
    }

    debug('reconnect in %sms', retryDelay);

    setTimeout(function () {
      self.retryAttempts += 1;
      self.emit('reconnecting', self.retryAttempts);
      self.connect();
    }, retryDelay);
  };
}

function dataHandler(self) {
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
}

function errorHandler(self) {
  return function (error) {
    self.silentEmit('error', error);
  };
}

function readyHandler(self) {
  return function () {
    debug('status: %s -> ready', self.status);

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
      if (self.condition.mode.subscriber) {
        var callback_count = 0;
        var callback = function () {
            callback_count--;
            if (callback_count === 0) {
                self.emit('ready');
            }
        };
        Object.keys(self.subscription_set).forEach(function (key) {
            var parts = key.split(" ");
            if (exports.debug_mode) {
                console.warn("sending pub/sub on_ready " + parts[0] + ", " + parts[1]);
            }
            callback_count++;
            self.send_command(parts[0] + "scribe", [parts[1]], callback);
        });
      }
      debug('send commands in offline queue: %d', self.offlineQueue.length);
      while (self.offlineQueue.length > 0) {
        var command = self.offlineQueue.shift();
        self.sendCommand(command);
      }
      self.offlineQueue = new Queue();
    }
  };
}
