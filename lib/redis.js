var _ = require('lodash');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var net = require('net');
var url = require('url');
var Queue = require('fastqueue');
var Command = require('./command');

/**
 * Creates a new Redis instance
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
 * ioRedis will check the status of the Redis server,
 * and when the Redis server is able to process commands,
 * a `ready` event will be emitted.
 * @param {boolean} [options.enableOfflineQueue=true] - By default,
 * if there is no active connection to the Redis server,
 * commands are added to a queue and are executed once the connection is "ready"
 * (when `enableReadyCheck` is `true`,
 * "ready" means the Redis server has loaded the database from disk, otherwise means the connection
 * to the Redis server has been established). If this option is false,
 * when execute the command when the connection isn't ready, an error will be returned.
 * @extends [EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)
 * @example
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
 */
function Redis(port, host, options) {
  if (!(this instanceof Redis)) return new Redis(port, host, options);

  EventEmitter.call(this);

  if (typeof port === 'object') {
    // Redis(options)
    this.options = _.cloneDeep(port);
  } else if (typeof port === 'string' && !isInt(port)) {
    // Redis(url, options)
    var parsedOptions = {};
    var parsedURL = url.parse(port, true, true);
    if (parsed.hostname) {
      parsedOptions.port = parsed.port;
      parsedOptions.host = parsed.hostname;
      if (parsed.auth) {
        parsedOptions.auth = parsed.auth.split(':')[1];
      }
    } else {
      parsedOptions.path = port;
    }
    this.options = _.defaults(host ? _.cloneDeep(host) : {}, parsedOptions);
  } else {
    // Redis(port, host, options)
    this.options = _.defaults(options ? _.cloneDeep(options) : {}, { port: port, host: host });
  }

  _.defaults(this.options, Redis._defaultOptions);

  this.parser = require('./parser/javascript');

  this.commandQueue = new Queue();
  this.offlineQueue = new Queue();

  // disconnected -> connected -> ready -> closing -> closed
  this.status = 'disconnected';

  this.condition = {
    select: this.options.select,
    auth: this.options.auth,
    mode: {
      subscriber: false,
      monitor: false
    }
  };

  this.connect();

  function isInt(value) {
    var x = parseFloat(value);
    return !isNaN(value) && (x | 0) === x;
  }
}

util.inherits(Redis, EventEmitter);

/**
 * Create a connection to Redis.
 * This method will be invoked automatically when creating a new Redis instance.
 * @public
 */
Redis.prototype.connect = function () {
  var connectionOptions;
  if (this.options.path) {
    connectionOptions = _.pick(this.options, ['path']);
  } else {
    connectionOptions = _.pick(this.options, ['port', 'host', 'family']);
  }
  this.initConnection(net.createConnection(connectionOptions));
};

/**
 * Disconnect from Redis.
 *
 * This method closes the connection immediately,
 * and may lose some pending replies that haven't written to clien.
 * If you want to wait for the pending replies, use Redis#quit instead.
 * @public
 */
Redis.prototype.disconnect = function () {
  this.status = 'closing';
  this.connection.end();
};

/**
 * Create a new instance, using the same options.
 *
 * @example
 * var redis = new Redis(6380);
 * var anotherRedis = redis.duplicate();
 *
 * @public
 */
Redis.prototype.duplicate = function () {
  return new Redis(this.options);
};

/**
 * Flush offline queue and command queue with error.
 *
 * @param {Error} error - The error object to send to the commands
 * @private
 */
Redis.prototype.flushQueue = function (error) {
  var command;
  while (this.offlineQueue.length > 0) {
    command = this.offlineQueue.shift();
    command.reject(error);
  }
  this.offlineQueue = new Queue();

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
      var retryTime = (obj.loading_eta_seconds || 1) * 1000;
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
 * @protected
 */
Redis.prototype.silentEmit = function (eventName) {
  if (this.listeners(eventName).length > 0) {
    return this.emit.apply(this, arguments);
  }
  return false;
};


_.assign(Redis, require('./redis/mixin/default_options'));

_.assign(Redis.prototype, require('./redis/mixin/prototype/commands'));
_.assign(Redis.prototype, require('./redis/mixin/prototype/events'));
_.assign(Redis.prototype, require('./redis/mixin/prototype/parser'));

module.exports = Redis;
