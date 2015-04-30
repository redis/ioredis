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
 * @param {boolean} [options.lazyConnect=true] - See Redis class
 * @param {number} [options.refreshAfterFails=10] - When a MOVED error is returned, it's considered
 * a failure. When the times of failures reach `refreshAfterFails`, client will call CLUSTER SLOTS
 * command to refresh the slots.
 * @extends [EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)
 * @extends Commander
 */
function RedisCluster (startupNodes, options) {
  EventEmitter.call(this);
  Commander.call(this);

  this.nodes = {};
  this.slots = [];
  this.connections = {};
  this.fails = 0;
  this.options = _.defaults(options || {}, this.options || {}, RedisCluster.defaultOptions);

  this.startupNodes = startupNodes.map(function (options) {
    return this.createNode(options.port, options.host);
  }, this);

  this.status = 'disconnected';
  this.offlineQueue = [];

  this.initializeSlotsCache();
}

/**
 * Default options
 *
 * @var defaultOptions
 * @protected
 */
RedisCluster.defaultOptions = _.assign({}, Redis.defaultOptions, {
  refreshAfterFails: 10,
  maxRedirections: 16,
  lazyConnect: true,
  retryStrategy: null
});

util.inherits(RedisCluster, EventEmitter);
_.extend(RedisCluster.prototype, Commander.prototype);

/**
 * Disconnect from every node in the cluster.
 *
 * @public
 */
RedisCluster.prototype.disconnect = function () {
  this.connecting = false;

  var keys = Object.keys(this.nodes);
  for (var i = 0; i < keys.length; ++i) {
    this.nodes[keys[i]].disconnect();
  }
};

RedisCluster.prototype.createNode = function (port, host) {
  var key = host + ':' + port;
  if (!this.nodes[key]) {
    this.nodes[key] = new Redis(_.assign({}, this.options, {
      port: port,
      host: host
    }));
  }
  return this.nodes[key];
};

RedisCluster.prototype.initializeSlotsCache = function () {
  this.connecting = true;

  var _this = this;
  tryNode(0);

  function tryNode(index) {
    if (index === _this.startupNodes.length) {
      _this.flushQueue(new Error('None of startup nodes is available'));
      return;
    }
    debug('try to connect to the node %d', index);
    _this.getInfoFromNode(_this.startupNodes[index], function (err) {
      if (!_this.connecting) {
        return;
      }
      if (err) {
        return tryNode(index + 1);
      }
      if (_this.status === 'disconnected') {
        _this.emit('connect');
        _this.executeOfflineCommands();
        _this.emit('ready');
        _this.status = 'ready';
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
RedisCluster.prototype.flushQueue = function (error) {
  var command;
  while (this.offlineQueue.length > 0) {
    command = this.offlineQueue.shift();
    command.reject(error);
  }
};

RedisCluster.prototype.executeOfflineCommands = function () {
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

RedisCluster.prototype.sendCommand = function (command) {
  var _this = this;

  var ttl = this.options.maxRedirections;
  tryConnection();

  var reject = command.reject;
  command.reject = function (err, result) {
    ttl -= 1;
    if (ttl <= 0) {
      return reject.call(command, new Error('Too many Cluster redirections. Last error: ' + err));
    }
    if (!err) {
      return command.resolve(result);
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
          if (++_this.fails > _this.options.refreshAfterFails) {
            _this.fails = 0;
            _this.initializeSlotsCache();
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

RedisCluster.prototype.getInfoFromNode = function (redis, callback) {
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
      var node = _this.nodes[key];
      node.disconnect();
      delete _this.nodes[key];
    });
    callback();
  }, 1000));
};

module.exports = RedisCluster;
