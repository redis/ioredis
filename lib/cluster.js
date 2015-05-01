'use strict';

var Redis = require('./redis');
var utils = require('./utils');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('ioredis:cluster');
var _ = require('lodash');
var Commander = require('./commander');

/**
 * Creates a Redis instance
 *
 * @constructor
 * @param {Object[]} startupNodes - An array of nodes in the cluster, [{ port: number, host: string }]
 * @param {Object} options
 * @param {boolean} [options.enableOfflineQueue=true] - See Redis class
 * @param {boolean} [options.lazyConnect=false] - See Redis class
 * @param {number} [options.refreshAfterFails=4] - When `MOVED` error is received more times than `refreshAfterFails`, client will call CLUSTER SLOTS
  command to refresh the slot cache.
 * @param {number} [options.maxRedirections=16] - When a MOVED or ASK error is received, client will redirect the
 * command to another node. This option limits the max redirections allowed to send a command.
 * @param {function} [options.clusterRetryStrategy] - See "Quick Start" section
 * @extends [EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)
 * @extends Commander
 */
function Cluster (startupNodes, options) {
  EventEmitter.call(this);
  Commander.call(this);

  if (!Array.isArray(startupNodes) || startupNodes.length === 0) {
    throw new Error('`startupNodes` should contain at least on node.');
  }
  this.startupNodes = startupNodes;

  this.nodes = {};
  this.slots = [];
  this.connections = {};
  this.fails = 0;
  this.retryAttempts = 0;
  this.options = _.defaults(options || {}, this.options || {}, Cluster.defaultOptions);
  this.offlineQueue = [];

  this.connect();
}

/**
 * Default options
 *
 * @var defaultOptions
 * @protected
 */
Cluster.defaultOptions = _.assign({}, Redis.defaultOptions, {
  refreshAfterFails: 4,
  maxRedirections: 16,
  clusterRetryStrategy: function (times) {
    return Math.min(100 + times * 2, 2000);
  }
});

util.inherits(Cluster, EventEmitter);
_.extend(Cluster.prototype, Commander.prototype);

Cluster.prototype.connect = function () {
  this.setStatus('connecting');

  var _this = this;
  this.startupNodes.forEach(function (options) {
    _this.createNode(options.port, options.host);
  });
  this.refreshSlotsCache(function (err) {
    if (err) {
      if (err.message === 'Failed to refresh slots cache.') {
        var retryDelay;
        if (typeof _this.options.clusterRetryStrategy === 'function') {
          retryDelay = _this.options.clusterRetryStrategy(++_this.retryAttempts);
        }
        if (typeof retryDelay === 'number') {
          setTimeout(function () {
            debug('None of startup nodes is available. Retrying after %dms', retryDelay);
            _this.connect();
          }, retryDelay);
        } else {
          _this.flushQueue(new Error('None of startup nodes is available'));
          _this.disconnect();
        }
      }
    } else {
      _this.retryAttempts = 0;
      _this.setStatus('connect');
      _this.executeOfflineCommands();
      _this.setStatus('ready');
    }
  });
};

/**
 * Disconnect from every node in the cluster.
 *
 * @public
 */
Cluster.prototype.disconnect = function () {
  this.setStatus('end');

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
    });
  }
  return this.nodes[key];
};

Cluster.prototype.setStatus = Redis.prototype.setStatus;

Cluster.prototype.refreshSlotsCache = function (callback) {
  if (typeof callback !== 'function') {
    callback = function () {};
  }

  var keys = Object.keys(this.nodes);

  var _this = this;
  tryNode(0);

  function tryNode(index) {
    if (index === keys.length) {
      return callback(new Error('Failed to refresh slots cache.'));
    }
    debug('connecting to %s', keys[index]);
    _this.getInfoFromNode(_this.nodes[keys[index]], function (err) {
      if (_this.status === 'end') {
        return callback(new Error('Cluster is disconnected.'));
      }
      if (err) {
        tryNode(index + 1);
      } else {
        callback();
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
  var command;
  while (this.offlineQueue.length > 0) {
    command = this.offlineQueue.shift();
    command.reject(error);
  }
};

Cluster.prototype.executeOfflineCommands = function () {
  if (this.offlineQueue.length) {
    debug('send %d commands in offline queue', this.offlineQueue.length);
    var offlineQueue = this.offlineQueue;
    this.offlineQueue = [];
    while (offlineQueue.length > 0) {
      var command = offlineQueue.shift();
      this.sendCommand(command);
    }
  }
};

Cluster.prototype.sendCommand = function (command) {
  var _this = this;

  var ttl = this.options.maxRedirections;
  tryConnection();

  var reject = command.reject;
  command.reject = function (err) {
    ttl -= 1;
    if (ttl <= 0) {
      return reject.call(command, new Error('Too many Cluster redirections. Last error: ' + err));
    }
    if (err instanceof Redis.ReplyError) {
      var errv = err.message.split(' ');
      if (errv[0] === 'MOVED' || errv[0] === 'ASK') {
        var hostPort = errv[2].split(':');
        var node = _this.createNode(hostPort[1], hostPort[0]);
        if (errv[0] === 'MOVED') {
          debug('command %s is moved to %s:%s', command.name, hostPort[0], hostPort[1]);
          _this.slots[errv[1]] = node;
          tryConnection();
          console.log('fails', _this.fails + 1, _this.options.refreshAfterFails);
          if (++_this.fails >= _this.options.refreshAfterFails) {
            console.log('refresh');
            _this.fails = 0;
            _this.refreshSlotsCache();
          }
        } else {
          debug('command %s is required to ask %s:%s', command.name, hostPort[0], hostPort[1]);
          tryConnection(false, node);
        }
      } else {
        reject.call(command, err);
      }
    } else {
      reject.call(command, err);
    }
  };

  function tryConnection (random, asking) {
    var redis;
    if (random || typeof command.getSlot() !== 'number') {
      redis = _this.nodes[_.sample(Object.keys(_this.nodes))];
    } else if (asking) {
      redis = asking;
      redis.asking();
    } else {
      redis = _this.slots[command.getSlot()];
    }
    if (redis) {
      redis.sendCommand(command);
    } else if (_this.options.enableOfflineQueue) {
      _this.offlineQueue.push(command);
    } else {
      command.reject(new Error('Cluster isn\'t connected and enableOfflineQueue options is false'));
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

module.exports = Cluster;
