'use strict';

var _ = require('lodash');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var Promise = require('bluebird');
var Deque = require('double-ended-queue');
var Command = require('./command');
var Commander = require('./commander');
var utils = require('./utils');
var eventHandler = require('./redis/event_handler');
var debug = require('debug')('ioredis:redis');
var Connector = require('./connectors/connector');
var SentinelConnector = require('./connectors/sentinel_connector');
var ScanStream = require('./scan_stream');
var JavaScriptParser = require('./parsers/javascript');
var NativeParser;
try {
  NativeParser = require('./parsers/hiredis');
} catch (e) {
}

/**
 * Creates a Redis instance
 *
 * @constructor
 * @param {(number|string|Object)} [port=6379] - Port of the Redis server,
 * or a URL string(see the examples below),
 * or the `options` object(see the third argument).
 * @param {string|Object} [host=localhost] - Host of the Redis server,
 * when the first argument is a URL string,
 * this argument is an object represents the options.
 * @param {Object} [options] - Other options.
 * @param {number} [options.port=6379] - Port of the Redis server.
 * @param {string} [options.host=localhost] - Host of the Redis server.
 * @param {string} [options.family=4] - Version of IP stack. Defaults to 4.
 * @param {string} [options.path=null] - Local domain socket path. If set the `port`, `host` and `family` will be ignored.
 * @param {number} [options.keepAlive=0] - TCP KeepAlive on the socket with a X ms delay before start. Set to a non-number value to disable keepAlive.
 * @param {number} [options.db=0] - Database index to use.
 * @param {string} [options.password=null] - If set, client will send AUTH command
 * with the value of this option when connected.
 * @param {boolean} [options.enableReadyCheck=true] - When a connection is established to
 * the Redis server, the server might still be loading the database from disk.
 * While loading, the server not respond to any commands.
 * To work around this, when this option is `true`,
 * ioredis will check the status of the Redis server,
 * and when the Redis server is able to process commands,
 * a `ready` event will be emitted.
 * @param {boolean} [options.enableOfflineQueue=true] - By default,
 * if there is no active connection to the Redis server,
 * commands are added to a queue and are executed once the connection is "ready"
 * (when `enableReadyCheck` is `true`,
 * "ready" means the Redis server has loaded the database from disk, otherwise means the connection
 * to the Redis server has been established). If this option is false,
 * when execute the command when the connection isn't ready, an error will be returned.
 * @param {number} [options.connectTimeout=10000] - The milliseconds before a timeout occurs during the initial connection to the Redis server.
 * @param {boolean} [options.autoResubscribe=true] - After reconnected, if the previous connection was in the subscriber mode, client will auto re-subscribe these channels.
 * @param {boolean} [options.autoResendUnfulfilledCommands=true] - If true, client will resend unfulfilled commands(e.g. block commands) in the previous connection when reconnected.
 * @param {boolean} [options.lazyConnect=false] - By default,
 * When a new `Redis` instance is created, it will connect to Redis server automatically.
 * If you want to keep disconnected util a command is called, you can pass the `lazyConnect` option to
 * the constructor:
 * @param {string} [options.keyPrefix=''] - The prefix to prepend to all keys in a command.

 * ```javascript
 * var redis = new Redis({ lazyConnect: true });
 * // No attempting to connect to the Redis server here.

 * // Now let's connect to the Redis server
 * redis.get('foo', function () {
 * });
 * ```
 * @param {function} [options.retryStrategy] - See "Quick Start" section
 * @param {function} [options.reconnectOnError] - See "Quick Start" section
 * @extends [EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)
 * @extends Commander
 * @example
 * ```js
 * var Redis = require('ioredis');
 *
 * var redis = new Redis();
 * // or: var redis = Redis();
 *
 * var redisOnPort6380 = new Redis(6380);
 * var anotherRedis = new Redis(6380, '192.168.100.1');
 * var unixSocketRedis = new Redis({ path: '/tmp/echo.sock' });
 * var unixSocketRedis2 = new Redis('/tmp/echo.sock');
 * var urlRedis = new Redis('redis://user:password@redis-service.com:6379/');
 * var urlRedis2 = new Redis('//localhost:6379');
 * var authedRedis = new Redis(6380, '192.168.100.1', { password: 'password' });
 * ```
 */
function Redis() {
  if (!(this instanceof Redis)) {
    return new Redis(arguments[0], arguments[1], arguments[2]);
  }

  EventEmitter.call(this);
  Commander.call(this);

  this.parseOptions(arguments[0], arguments[1], arguments[2]);

  if (this.options.parser === 'javascript') {
    this.Parser = JavaScriptParser;
  } else {
    this.Parser = NativeParser || JavaScriptParser;
  }

  this.resetCommandQueue();
  this.resetOfflineQueue();

  if (this.options.sentinels) {
    this.connector = new SentinelConnector(this.options);
  } else {
    this.connector = new Connector(this.options);
  }

  this.retryAttempts = 0;

  // end(or wait) -> connecting -> connect -> ready -> end
  if (this.options.lazyConnect) {
    this.setStatus('wait');
  } else {
    this.connect().catch(function () {});
  }
}

util.inherits(Redis, EventEmitter);
_.assign(Redis.prototype, Commander.prototype);

/**
 * Create a Redis instance
 *
 * @deprecated
 */
Redis.createClient = function () {
  return Redis.apply(this, arguments);
};

/**
 * Default options
 *
 * @var defaultOptions
 * @protected
 */
Redis.defaultOptions = {
  // Connection
  port: 6379,
  host: 'localhost',
  family: 4,
  connectTimeout: 3000,
  retryStrategy: function (times) {
    return Math.min(times * 2, 2000);
  },
  keepAlive: 0,
  // Sentinel
  sentinels: null,
  name: null,
  role: 'master',
  sentinelRetryStrategy: function (times) {
    return Math.min(times * 10, 1000);
  },
  // Status
  password: null,
  db: 0,
  // Others
  parser: 'auto',
  enableOfflineQueue: true,
  enableReadyCheck: true,
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,
  lazyConnect: false,
  keyPrefix: '',
  reconnectOnError: null
};

Redis.prototype.resetCommandQueue = function () {
  this.commandQueue = new Deque();
};

Redis.prototype.resetOfflineQueue = function () {
  this.offlineQueue = new Deque();
};

Redis.prototype.parseOptions = function () {
  this.options = {};
  for (var i = 0; i < arguments.length; ++i) {
    var arg = arguments[i];
    if (arg === null || typeof arg === 'undefined') {
      continue;
    }
    if (typeof arg === 'object') {
      _.defaults(this.options, arg);
    } else if (typeof arg === 'string') {
      _.defaults(this.options, utils.parseURL(arg));
    } else if (typeof arg === 'number') {
      this.options.port = arg;
    } else {
      throw new Error('Invalid argument ' + arg);
    }
  }
  _.defaults(this.options, Redis.defaultOptions);

  if (typeof this.options.port === 'string') {
    this.options.port = parseInt(this.options.port, 10);
  }
  if (typeof this.options.db === 'string') {
    this.options.db = parseInt(this.options.db, 10);
  }
};

/** Change instance's status
 * @private
 */
Redis.prototype.setStatus = function (status, arg) {
  debug('status[%s]: %s -> %s', (this.options.path ? this.options.path : (this.options.host + ':' + this.options.port)), this.status || '[empty]', status);
  this.status = status;
  process.nextTick(this.emit.bind(this, status, arg));
};


/**
 * Create a connection to Redis.
 * This method will be invoked automatically when creating a new Redis instance.
 * @param {function} callback
 * @return {Promise}
 * @public
 */
Redis.prototype.connect = function (callback) {
  return new Promise(function (resolve, reject) {
    if (this.status === 'connecting' || this.status === 'connect' || this.status === 'ready') {
      reject(new Error('Redis is already connecting/connected'));
      return;
    }
    this.setStatus('connecting');

    this.condition = {
      select: this.options.db,
      auth: this.options.password,
      subscriber: false
    };

    var _this = this;
    this.connector.connect(function (err, stream) {
      if (err) {
        _this.flushQueue(err);
        reject(err);
        return;
      }

      _this.stream = stream;
      if (typeof _this.options.keepAlive === 'number') {
        stream.setKeepAlive(true, _this.options.keepAlive);
      }

      stream.once('connect', eventHandler.connectHandler(_this));
      stream.once('error', eventHandler.errorHandler(_this));
      stream.once('close', eventHandler.closeHandler(_this));
      stream.on('data', eventHandler.dataHandler(_this));

      if (_this.options.connectTimeout) {
        stream.setTimeout(_this.options.connectTimeout, function () {
          stream.setTimeout(0);
          stream.destroy();
        });
        stream.once('connect', function () {
          stream.setTimeout(0);
        });
      }

      var connectionConnectHandler = function () {
        _this.removeListener('close', connectionCloseHandler);
        resolve();
      };
      var connectionCloseHandler = function (err) {
        _this.removeListener('connect', connectionConnectHandler);
        reject(err);
      };
      _this.once('connect', connectionConnectHandler);
      _this.once('close', connectionCloseHandler);
    });
  }.bind(this)).nodeify(callback);
};

/**
 * Disconnect from Redis.
 *
 * This method closes the connection immediately,
 * and may lose some pending replies that haven't written to client.
 * If you want to wait for the pending replies, use Redis#quit instead.
 * @public
 */
Redis.prototype.disconnect = function (reconnect) {
  if (!reconnect) {
    this.manuallyClosing = true;
  }
  if (this.reconnectTimeout) {
    clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
  }
  this.connector.disconnect();
};

/**
 * Disconnect from Redis.
 *
 * @deprecated
 */
Redis.prototype.end = function () {
  this.disconnect();
};

/**
 * Create a new instance with the same options as the current one.
 *
 * @example
 * ```js
 * var redis = new Redis(6380);
 * var anotherRedis = redis.duplicate();
 * ```
 *
 * @public
 */
Redis.prototype.duplicate = function (override) {
  return new Redis(_.assign(_.cloneDeep(this.options), override || {}));
};

/**
 * Flush offline queue and command queue with error.
 *
 * @param {Error} error - The error object to send to the commands
 * @private
 */
Redis.prototype.flushQueue = function (error) {
  var item;
  while (this.offlineQueue.length > 0) {
    item = this.offlineQueue.shift();
    item.command.reject(error);
  }

  while (this.commandQueue.length > 0) {
    item = this.commandQueue.shift();
    item.command.reject(error);
  }
};

/**
 * Check whether Redis has finished loading the persistent data and is able to
 * process commands.
 *
 * @param {Function} callback
 * @private
 */
Redis.prototype._readyCheck = function (callback) {
  var _this = this;
  this.info(function (err, res) {
    if (err) {
      return callback(err);
    }
    if (typeof res !== 'string') {
      return callback(null, res);
    }

    var info = {};

    var lines = res.split('\r\n');
    for (var i = 0; i < lines.length; ++i) {
      var parts = lines[i].split(':');
      if (parts[1]) {
        info[parts[0]] = parts[1];
      }
    }

    if (!info.loading || info.loading === '0') {
      callback(null, info);
    } else {
      var retryTime = (info.loading_eta_seconds || 1) * 1000;
      debug('Redis server still loading, trying again in ' + retryTime + 'ms');
      setTimeout(function () {
        _this._readyCheck(callback);
      }, retryTime);
    }
  });
};

/**
 * Emit only when there's at least one listener.
 *
 * @param {string} eventName - Event to emit
 * @param {...*} arguments - Arguments
 * @return {boolean} Returns true if event had listeners, false otherwise.
 * @private
 */
Redis.prototype.silentEmit = function (eventName) {
  if (this.listeners(eventName).length > 0) {
    return this.emit.apply(this, arguments);
  }
  return false;
};

/**
 * Listen for all requests received by the server in real time.
 *
 * This command will create a new connection to Redis and send a
 * MONITOR command via the new connection in order to avoid disturbing
 * the current connection.
 *
 * @param {function} [callback] The callback function. If omit, a promise will be returned.
 * @example
 * ```js
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
 * ```
 * @public
 */
Redis.prototype.monitor = function (callback) {
  var monitorInstance = this.duplicate({
    monitor: true,
    lazyConnect: false
  });

  return new Promise(function (resolve) {
    monitorInstance.once('monitoring', function () {
      resolve(monitorInstance);
    });
  }).nodeify(callback);
};

require('./transaction').addTransactionSupport(Redis.prototype);

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
 * ```js
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
 * ```
 * @private
 */
Redis.prototype.sendCommand = function (command, stream) {
  if (this.status === 'wait') {
    this.connect().catch(function () {});
  }
  if (this.status === 'end') {
    command.reject(new Error('Connection is closed.'));
    return command.promise;
  }
  if (this.condition.subscriber && !_.includes(Command.FLAGS.VALID_IN_SUBSCRIBER_MODE, command.name)) {
    command.reject(new Error('Connection in subscriber mode, only subscriber commands may be used'));
    return command.promise;
  }

  var writable = (this.status === 'ready') || ((this.status === 'connect') &&  _.includes(Command.FLAGS.VALID_WHEN_LOADING, command.name));
  if (!this.stream) {
    writable = false;
  } else if (!this.stream.writable) {
    writable = false;
  } else if (this.stream._writableState && this.stream._writableState.ended) {
    // https://github.com/iojs/io.js/pull/1217
    writable = false;
  }

  if (!writable && !this.options.enableOfflineQueue) {
    command.reject(new Error('Stream isn\'t writeable and enableOfflineQueue options is false'));
    return command.promise;
  }

  if (writable) {
    debug('write command[%d] -> %s(%s)', this.condition.select, command.name, command.args);
    (stream || this.stream).write(command.toWritable());

    this.commandQueue.push({
      command: command,
      stream: stream,
      select: this.condition.select
    });

    if (_.includes(Command.FLAGS.WILL_DISCONNECT, command.name)) {
      this.manuallyClosing = true;
    }
  } else if (this.options.enableOfflineQueue) {
    debug('queue command[%d] -> %s(%s)', this.condition.select, command.name, command.args);
    this.offlineQueue.push({
      command: command,
      stream: stream,
      select: this.condition.select
    });
  }

  if (command.name === 'select' && utils.isInt(command.args[0])) {
    this.condition.select = parseInt(command.args[0], 10);
    debug('switch to db [%d]', this.condition.select);
  }

  return command.promise;
};

['scan', 'sscan', 'hscan', 'zscan', 'scanBuffer', 'sscanBuffer', 'hscanBuffer', 'zscanBuffer'].forEach(function (command) {
  Redis.prototype[command + 'Stream'] = function (key, options) {
    if (command === 'scan' || command === 'scanBuffer') {
      options = key;
      key = null;
    }
    return new ScanStream(_.defaults({
      objectMode: true,
      key: key,
      redis: this,
      command: command
    }, options));
  };
});

_.assign(Redis.prototype, require('./redis/parser'));

module.exports = Redis;
