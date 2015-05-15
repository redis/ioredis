'use strict';

var Redis = require('./redis');
var utils = require('./utils');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('ioredis:cluster');
var _ = require('lodash');
var Commander = require('./commander');

/**
 * Creates a Redis Cluster instance
 *
 * @constructor
 * @param {Object[]} startupNodes - An array of nodes in the cluster, [{ port: number, host: string }]
 * @param {Object} options
 * @param {boolean} [options.enableOfflineQueue=true] - See Redis class
 * @param {boolean} [options.lazyConnect=false] - See Redis class
 * @param {number} [options.maxRedirections=16] - When a MOVED or ASK error is received, client will redirect the
 * command to another node. This option limits the max redirections allowed to send a command.
 * @param {function} [options.clusterRetryStrategy] - See "Quick Start" section
 * @param {number} [options.retryDelayOnFailover=2000] - When an error is received when sending a command(e.g. "Connection is closed." when the target Redis node is down),
 * @param {number} [options.retryDelayOnClusterDown=1000] - When a CLUSTERDOWN error is received, client will retry if `retryDelayOnClusterDown` is valid delay time.
 * @extends [EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)
 * @extends Commander
 */
function Cluster (startupNodes, options) {
  EventEmitter.call(this);
  Commander.call(this);

  if (!Array.isArray(startupNodes) || startupNodes.length === 0) {
    throw new Error('`startupNodes` should contain at least one node.');
  }
  this.startupNodes = startupNodes;

  this.nodes = {};
  this.slots = [];
  this.connections = {};
  this.retryAttempts = 0;
  this.options = _.defaults(options || {}, this.options || {}, Cluster.defaultOptions);
  this.offlineQueue = [];

  this.connect().catch(function () {});
}

/**
 * Default options
 *
 * @var defaultOptions
 * @protected
 */
Cluster.defaultOptions = _.assign({}, Redis.defaultOptions, {
  maxRedirections: 16,
  retryDelayOnFailover: 2000,
  retryDelayOnClusterDown: 1000,
  clusterRetryStrategy: function (times) {
    return Math.min(100 + times * 2, 2000);
  }
});

util.inherits(Cluster, EventEmitter);
_.extend(Cluster.prototype, Commander.prototype);

Cluster.prototype.connect = function () {
  return new Promise(function (resolve, reject) {
    if (this.status === 'connecting' || this.status === 'connect' || this.status === 'ready') {
      reject(new Error('Redis is already connecting/connected'));
      return;
    }
    this.setStatus('connecting');

    var refreshListener = function () {
      this.removeListener('end', endListener);
      this.retryAttempts = 0;
      this.manuallyClosing = false;
      this.setStatus('connect');
      this.setStatus('ready');
      this.executeOfflineCommands();
      resolve();
    };

    var endListener = function () {
      this.removeListener('refresh', refreshListener);
      reject(new Error('None of startup nodes is available'));
    };

    this.once('refresh', refreshListener);
    this.once('end', endListener);

    this.once('close', function () {
      var retryDelay;
      if (!this.manuallyClosing && typeof this.options.clusterRetryStrategy === 'function') {
        retryDelay = this.options.clusterRetryStrategy(++this.retryAttempts);
      }
      if (typeof retryDelay === 'number') {
        this.setStatus('reconnecting');
        setTimeout(function () {
          debug('Cluster is disconnected. Retrying after %dms', retryDelay);
          this.connect().catch(function () {});
        }.bind(this), retryDelay);
      } else {
        this.setStatus('end');
        this.flushQueue(new Error('None of startup nodes is available'));
      }
    });

    this.startupNodes.forEach(function (options) {
      this.createNode(options.port, options.host);
    }, this);
    this.refreshSlotsCache();
  }.bind(this));
};

/**
 * Disconnect from every node in the cluster.
 *
 * @public
 */
Cluster.prototype.disconnect = function (reconnect) {
  if (!reconnect) {
    this.manuallyClosing = true;
  }
  var keys = Object.keys(this.nodes);
  for (var i = 0; i < keys.length; ++i) {
    this.nodes[keys[i]].disconnect();
  }
};

/**
 * Create a connection and add it to the connection list
 *
 * @param {number} port
 * @param {string} host
 * @return {Redis} A redis instance
 * @private
 */
Cluster.prototype.createNode = function (port, host) {
  var key = host + ':' + port;
  if (!this.nodes[key]) {
    this.nodes[key] = new Redis(_.assign({}, this.options, {
      port: port,
      host: host,
      retryStrategy: null
    }));

    var _this = this;
    this.nodes[key].once('end', function () {
      delete _this.nodes[key];
      if (Object.keys(_this.nodes).length === 0) {
        _this.setStatus('close');
      }
    });
  }
  return this.nodes[key];
};

Cluster.prototype.setStatus = function (status) {
  debug('status: %s -> %s', this.status || '[empty]', status);
  this.status = status;
  process.nextTick(this.emit.bind(this, status));
};

Cluster.prototype.refreshSlotsCache = function (callback) {
  if (this.isRefreshing) {
    if (typeof callback === 'function') {
      process.nextTick(function () {
        callback();
      });
    }
    return;
  }
  this.isRefreshing = true;
  var wrapper = function () {
    _this.isRefreshing = false;
    if (typeof callback === 'function') {
      callback.apply(null, arguments);
    }
  };

  var keys = _.shuffle(Object.keys(this.nodes));

  var _this = this;
  tryNode(0);

  function tryNode(index) {
    if (index === keys.length) {
      return wrapper(new Error('Failed to refresh slots cache.'));
    }
    debug('getting slot cache from %s', keys[index]);
    _this.getInfoFromNode(_this.nodes[keys[index]], function (err) {
      if (_this.status === 'end') {
        return wrapper(new Error('Cluster is disconnected.'));
      }
      if (err) {
        tryNode(index + 1);
      } else {
        _this.emit('refresh');
        wrapper();
      }
    });
  }
};

/**
 * Flush offline queue and command queue with error.
 *
 * @param {Error} error - The error object to send to the commands
 * @private
 */
Cluster.prototype.flushQueue = function (error) {
  var item;
  while (this.offlineQueue.length > 0) {
    item = this.offlineQueue.shift();
    item.command.reject(error);
  }
};

Cluster.prototype.executeOfflineCommands = function () {
  if (this.offlineQueue.length) {
    debug('send %d commands in offline queue', this.offlineQueue.length);
    var offlineQueue = this.offlineQueue;
    this.offlineQueue = [];
    while (offlineQueue.length > 0) {
      var item = offlineQueue.shift();
      this.sendCommand(item.command, item.stream, item.slot);
    }
  }
};

Cluster.prototype.sendCommand = function (command, stream, slot) {
  if (this.status === 'end') {
    command.reject(new Error('Connection is closed.'));
    return command.promise;
  }

  var targetSlot = (typeof slot === 'number') ? slot : command.getSlot();
  var ttl = this.options.maxRedirections;
  var reject = command.reject;
  var _this = this;
  command.reject = function (err) {
    if (err instanceof Redis.ReplyError) {
      var errv = err.message.split(' ');
      if (!slot && (errv[0] === 'MOVED' || errv[0] === 'ASK')) {
        ttl -= 1;
        if (ttl <= 0) {
          return reject.call(command, new Error('Too many Cluster redirections. Last error: ' + err));
        }
        var hostPort = errv[2].split(':');
        var node = _this.createNode(hostPort[1], hostPort[0]);
        if (errv[0] === 'MOVED') {
          debug('command %s is moved to %s:%s', command.name, hostPort[0], hostPort[1]);
          _this.slots[errv[1]] = node;
          tryConnection();
          _this.refreshSlotsCache();
        } else {
          debug('command %s is required to ask %s:%s', command.name, hostPort[0], hostPort[1]);
          tryConnection(false, node);
        }
      } else if (errv[0] === 'CLUSTERDOWN' && _this.options.retryDelayOnClusterDown > 0) {
        debug('command %s is rejected because CLUSTERDOWN. Refreshing the slot cache after %dms', command.name, _this.options.retryDelayOnClusterDown);
        setTimeout(function () {
          _this.refreshSlotsCache(function () {
            tryConnection();
          });
        }, _this.options.retryDelayOnClusterDown);
      } else {
        reject.call(command, err);
      }
    } else if (err.message === 'Connection is closed.' && _this.options.retryDelayOnFailover > 0) {
      debug('command %s is rejected because %s. Refreshing the slot cache...', command.name, err);
      setTimeout(function () {
        _this.refreshSlotsCache(function () {
          tryConnection();
        });
      }, _this.options.retryDelayOnFailover);
    } else {
      reject.call(command, err);
    }
  };

  tryConnection();

  function tryConnection (random, asking) {
    if (_this.status === 'end') {
      command.reject(new Error('Cluster is ended.'));
      return;
    }
    if (_this.status === 'ready') {
      var redis;
      if (typeof targetSlot === 'number') {
        redis = _this.slots[targetSlot];
      } else if (asking && !random) {
        redis = asking;
        redis.asking();
      }
      if (random || typeof targetSlot !== 'number' || !redis) {
        redis = _this.nodes[_.sample(Object.keys(_this.nodes))];
      }
      redis.sendCommand(command, stream);
    } else if (_this.options.enableOfflineQueue) {
      _this.offlineQueue.push({
        command: command,
        stream: stream,
        slot: slot
      });
    } else {
      command.reject(new Error('Cluster isn\'t ready and enableOfflineQueue options is false'));
    }
  }
  return command.promise;
};

Cluster.prototype.getInfoFromNode = function (redis, callback) {
  if (!redis) {
    return callback(new Error('Node is disconnected'));
  }
  var _this = this;
  redis.cluster('slots', utils.timeout(function (err, result) {
    if (err) {
      redis.disconnect();
      return callback(err);
    }
    var i;
    var oldNodes = {};
    var keys = Object.keys(_this.nodes);
    for (i = 0; i < keys.length; ++i) {
      oldNodes[keys[i]] = true;
    }
    for (i = 0; i < result.length; ++i) {
      var item = result[i];
      var host = item[2][0];
      var port = item[2][1];
      var node = _this.createNode(port, host);
      delete oldNodes[host + ':' + port];
      for (var slot = item[0]; slot <= item[1]; ++slot) {
        _this.slots[slot] = node;
      }
    }
    Object.keys(oldNodes).forEach(function (key) {
      _this.nodes[key].disconnect();
      delete _this.nodes[key];
    });
    callback();
  }, 1000));
};

require('./transaction').addTransactionSupport(Cluster.prototype);

module.exports = Cluster;
