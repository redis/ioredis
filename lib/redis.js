var _ = require('lodash');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var net = require('net');
var Promise = require('bluebird');
var url = require('url');
var Pipeline = require('./pipeline');
var Queue = require('fastqueue');
var Command = require('./command');
var Commander = require('./commander');
var Script = require('./script');
var utils = require('./utils');
var eventHandler = require('./redis/event_handler');
var debug = require('debug')('ioredis:redis');

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
 * @param {string} [options.path=null] - Local domain socket path. If set the `port`, `host`
 * and `family` will be ignored.
 * @param {string} [options.auth=null] - If set, client will send AUTH command
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
 * @param {boolean} [options.lazyConnect=false] - By default,
 * When a new `Redis` instance is created, it will connect to Redis server automatically.
 * If you want to keep disconnected util a command is called, you can pass the `lazyConnect` option to
 * the constructor:

 * ```javascript
 * var redis = new Redis({ lazyConnect: true });
 * // No attempting to connect to the Redis server here.

 * // Now let's connect to the Redis server
 * redis.get('foo', function () {
 * });
 * ```
 * @param {function} [options.retryStrategy] - See "Quick Start" section
 * @extends [EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)
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
 * var authedRedis = new Redis(6380, '192.168.100.1', { auth: 'password' });
 * ```
 */
function Redis(port, host, options) {
  if (!(this instanceof Redis)) {
    return new Redis(port, host, options);
  }

  EventEmitter.call(this);
  Commander.call(this);

  if (typeof port === 'object') {
    // Redis(options)
    this.options = _.cloneDeep(port);
  } else if (typeof port === 'string' && !utils.isInt(port)) {
    // Redis(url, options)
    var parsedOptions = {};
    var parsedURL = url.parse(port, true, true);
    if (parsedURL.hostname) {
      parsedOptions.port = parsedURL.port;
      parsedOptions.host = parsedURL.hostname;
      if (parsedURL.auth) {
        parsedOptions.password = parsedURL.auth.split(':')[1];
      }
      if (parsedURL.path) {
        parsedOptions.db = parseInt(parsedURL.path.slice(1), 10);
      }
    } else {
      parsedOptions.path = port;
    }
    this.options = _.defaults(host ? _.cloneDeep(host) : {}, parsedOptions);
  } else {
    // Redis(port, host, options) or Redis(port, options)
    if (host && typeof host === 'object') {
      this.options = _.defaults(_.cloneDeep(host), { port: port });
    } else {
      this.options = _.defaults(options ? _.cloneDeep(options) : {}, { port: port, host: host });
    }
  }

  _.defaults(this.options, Redis._defaultOptions);
  if (typeof this.options.port === 'string') {
    this.options.port = parseInt(this.options.port, 10);
  }

  if (this.options.parser === 'javascript') {
    this.Parser = require('./parsers/javascript');
  } else {
    try {
      this.Parser = require('./parsers/hiredis');
    } catch (e) {
      if (this.options.parser === 'hiredis') {
        throw e;
      }
      this.Parser = require('./parsers/javascript');
    }
  }

  this.commandQueue = new Queue();
  this.offlineQueue = new Queue();
  this.scriptsSet = {};

  if (this.options.sentinels) {
    this._sentinel = new Sentinel(this.options.sentinels, this.options.role, this.options.name);
  }

  this.retryAttempts = 0;

  // disconnected(or inactive) -> connected -> ready -> closing -> closed
  if (this.options.lazyConnect) {
    this.status = 'inactive';
  } else {
    this.status = 'disconnected';
    this.connect();
  }
}

util.inherits(Redis, EventEmitter);
_.extend(Redis.prototype, Commander.prototype);

/**
 * Create a Redis instance
 *
 * @deprecated
 */
Redis.prototype.createClient = util.deprecate(function () {
  return Redis.apply(this, arguments);
}, 'Redis.createClient: Use new Redis() instead');

/**
 * Default options
 *
 * @var _defaultOptions
 * @private
 */
Redis._defaultOptions = {
  port: 6379,
  host: 'localhost',
  family: 4,
  enableOfflineQueue: true,
  enableReadyCheck: true,
  retryStrategy: function (times) {
    var delay = Math.min(times * 2, 2000);
    return delay;
  },
  autoResubscribe: true,
  parser: 'auto',
  lazyConnect: false,
  password: null,
  db: 0,
  role: 'master',
  sentinel: null,
  roleRetryDelay: 500,
  connectTimeout: 10000,
  name: null
};


/**
 * Create a connection to Redis.
 * This method will be invoked automatically when creating a new Redis instance.
 * @public
 */
Redis.prototype.connect = function () {
  this.condition = {
    select: this.options.db,
    auth: this.options.password,
    mode: {
      subscriber: false,
      monitor: false
    }
  };

  if (this._sentinel) {
    var _this = this;
    this._sentinel.removeAllListeners();
    this._sentinel.once('connect', function (connection) {
      debug('received connection from sentinel');
      _this.connection = connection;
      bindEvent(_this);
    });
    this._sentinel.on('error', function (error) {
      _this.silentEmit('error', error);
    });
    this._sentinel.connect(this.options.role);
  } else {
    var connectionOptions;
    if (this.options.path) {
      connectionOptions = _.pick(this.options, ['path']);
    } else {
      connectionOptions = _.pick(this.options, ['port', 'host', 'family']);
    }
    this.connection = net.createConnection(connectionOptions);
    bindEvent(this);
  }

  function bindEvent(self) {
    self.connection.once('connect', eventHandler.connectHandler(self));
    self.connection.once('error', eventHandler.errorHandler(self));
    self.connection.once('close', eventHandler.closeHandler(self));
    self.connection.on('data', eventHandler.dataHandler(self));
    if (self.options.connectTimeout) {
      self.connection.setTimeout(self.options.connectTimeout, function () {
        self.connection.setTimeout(0);
        self.manuallyClosing = true;
        self.connection.destroy();
      });
      self.connection.once('connect', function () {
        self.connection.setTimeout(0);
      });
    }
  }
};

/**
 * Disconnect from Redis.
 *
 * This method closes the connection immediately,
 * and may lose some pending replies that haven't written to clien.
 * If you want to wait for the pending replies, use Redis#quit instead.
 * @public
 */
Redis.prototype.disconnect = function (options) {
  options = options || {};
  this.manuallyClosing = !options.reconnect;

  if (this.connection) {
    this.connection.end();
  }
  if (this._sentinel) {
    this._sentinel.disconnect(options);
  }
};

/**
 * Create a new instance, using the same options.
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
  return new Redis(_.defaults(override || {}, this.options));
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
  this.offlineQueue = new Queue();

  var command;
  while (this.commandQueue.length > 0) {
    command = this.commandQueue.shift();
    command.reject(error);
  }
  this.commandQueue = new Queue();
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
  this.sendCommand(new Command('info', null, 'utf8', function (err, res) {
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
  }));
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

Redis.prototype.defineCommand = function (name, definition) {
  var script = new Script(definition.lua, definition.numberOfKeys);
  this.scriptsSet[name] = script;
  this[name] = function () {
    var args = _.toArray(arguments);
    var callback;

    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    return script.execute(this, args, 'utf8', callback);
  };

  this[name + 'Buffer'] = function () {
    var args = _.toArray(arguments);
    var callback;

    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    return script.execute(this, args, null, callback);
  };
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
  var monitorInstance = this.duplicate({ lazyConnect: false });
  monitorInstance.options.enableReadyCheck = false;
  monitorInstance.condition.mode.monitoring = true;
  monitorInstance.prevCondition = monitorInstance.condition;

  return new Promise(function (resolve) {
    monitorInstance.once('monitoring', function () {
      resolve(monitorInstance);
    });
  }).nodeify(callback);
};

Redis.prototype.pipeline = function () {
  var pipeline = new Pipeline(this);
  return pipeline;
};

var multi = Redis.prototype.multi;
Redis.prototype.multi = function (options) {
  if (options && options.pipeline === false) {
    multi.call(this);
  } else {
    var pipeline = new Pipeline(this);
    pipeline.multi();
    var exec = pipeline.exec;
    pipeline.exec = function (callback) {
      exec.call(pipeline);
      var promise = exec.call(pipeline);
      return promise.then(function (result) {
        var execResult = result[result.length - 1];
        if (execResult[0]) {
          throw execResult[0];
        }
        return utils.wrapMultiResult(execResult[1]);
      }).nodeify(callback);
    };
    return pipeline;
  }
};

var exec = Redis.prototype.exec;
Redis.prototype.exec = function (callback) {
  var wrapper = function (err, results) {
    if (Array.isArray(results)) {
      results = utils.wrapMultiResult(results);
    }
    callback(err, results);
  };
  exec.call(this, wrapper);
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
  if (this.status === 'inactive') {
    this.status = 'disconnected';
    this.connect();
  }
  if (this.condition.mode.subscriber && !_.includes(Command.FLAGS.VALID_IN_SUBSCRIBER_MODE, command.name)) {
    command.reject(new Error('Connection in subscriber mode, only subscriber commands may be used'));
    return command.promise;
  }

  var writable = (this.status === 'ready') || ((this.status === 'connected') &&  _.includes(Command.FLAGS.VALID_WHEN_LOADING, command.name));
  if (!stream) {
    if (!this.connection) {
      writable = false;
    } else if (!this.connection.writable) {
      writable = false;
    } else if (this.connection._writableState && this.connection._writableState.ended) {
      // https://github.com/iojs/io.js/pull/1217
      writable = false;
    }
  }

  if (writable) {
    debug('write command[%d] -> %s(%s)', this.condition.select, command.name, command.args);
    (stream || this.connection).write(command.toWritable());

    this.commandQueue.push(command);

    if (_.includes(Command.FLAGS.WILL_DISCONNECT, command.name)) {
      this.manuallyClosing = true;
    }

    if (command.name === 'select' && utils.isInt(command.args[0])) {
      this.condition.select = parseInt(command.args[0], 10);
      debug('switch to db [%d]', this.condition.select);
    }

  } else if (this.options.enableOfflineQueue) {
    debug('queue command[%d] -> %s(%s)', this.condition.select, command.name, command.args);
    this.offlineQueue.push({
      command: command,
      stream: stream,
      select: this.condition.select
    });
    if (command.name === 'select' && utils.isInt(command.args[0])) {
      this.condition.select = parseInt(command.args[0], 10);
      debug('switch to db [%d]', this.condition.select);
    }
  } else {
    command.reject(new Error('Stream isn\'t writeable and enableOfflineQueue options is false'));
  }

  return command.promise;
};

_.assign(Redis.prototype, require('./redis/prototype/parser'));

module.exports = Redis;

Redis.Command = Command;

Redis.Command.setArgumentTransformer('mset', function (args) {
  if (args.length === 1) {
    if (typeof Map !== 'undefined' && args[0] instanceof Map) {
      return utils.convertMapToArray(args[0]);
    }
    if ( typeof args[0] === 'object' && args[0] !== null) {
      return utils.convertObjectToArray(args[0]);
    }
  }
  return args;
});

Redis.Command.setArgumentTransformer('hmset', function (args) {
  if (args.length === 2) {
    if (typeof Map !== 'undefined' && args[1] instanceof Map) {
      return [args[0]].concat(utils.convertMapToArray(args[1]));
    }
    if ( typeof args[1] === 'object' && args[1] !== null) {
      return [args[0]].concat(utils.convertObjectToArray(args[1]));
    }
  }
  return args;
});

Redis.Command.setReplyTransformer('hgetall', function (result) {
  if (Array.isArray(result)) {
    var obj = {};
    for (var i = 0; i < result.length; i += 2) {
      obj[result[i]] = result[i + 1];
    }
    return obj;
  }
  return result;
});

Redis.Cluster = require('./redis_cluster');

Redis.ReplyError = require('./reply_error');

var Sentinel = require('./sentinel');
