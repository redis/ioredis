var Redis = require('./redis');
var utils = require('./utils');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('ioredis:cluster');
var _ = require('lodash');
var ClusterCommand = require('./cluster_command');
var Commander = require('./commander');
var Queue = require('fastqueue');

function RedisCluster (startupNodes, options) {
  EventEmitter.call(this);
  Commander.call(this);

  this.nodes = {};
  this.slots = [];
  this.startupNodes = startupNodes.map(function (options) {
    return this.createNode(options.port, options.host);
  }, this);
  this.connections = {};
  this.fails = 0;

  this.options = _.defaults(options || {}, RedisCluster._defaultOptions);

  this.status = 'disconnected';
  this.offlineQueue = new Queue();

  this.initializeSlotsCache();
}

/**
 * Default options
 *
 * @var _defaultOptions
 * @private
 */
RedisCluster._defaultOptions = {
  enableOfflineQueue: true,
  refreshAfterFails: 10
};

util.inherits(RedisCluster, EventEmitter);
_.extend(RedisCluster.prototype, Commander.prototype);

RedisCluster.prototype.createNode = function (port, host) {
  var key = host + ':' + port;
  if (!this.nodes[key]) {
    this.nodes[key] = new Redis({ port: port, host: host, lazyConnect: true });
  }
  return this.nodes[key];
};

RedisCluster.prototype.initializeSlotsCache = function () {
  var _this = this;

  tryNode(0);

  function tryNode(index) {
    if (index === _this.startupNodes.length) {
      _this.flushQueue(new Error('None of startup nodes is available'));
      return;
    }
    debug('try to connect to the node %d', index);
    _this.getInfoFromNode(_this.startupNodes[index], function (err) {
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
  var item;
  while (this.offlineQueue.length > 0) {
    command = this.offlineQueue.shift();
    command.reject(error);
  }
  this.offlineQueue = new Queue();
};

RedisCluster.prototype.executeOfflineCommands = function () {
  if (this.offlineQueue.length) {
    debug('send %d commands in offline queue', this.offlineQueue.length);
    var offlineQueue = this.offlineQueue;
    this.offlineQueue = new Queue();
    while (offlineQueue.length > 0) {
      var command = offlineQueue.shift();
      this.sendCommand(command);
    }
    offlineQueue = null;
  }
};

RedisCluster.prototype.sendCommand = function (command) {
  if (command.args.length === 0) {
    return command.reject(new Error('Invalid command ' + command.name + ' in cluster mode'));
  }
  var _this = this;
  var clusterCommand = new ClusterCommand(command, function (err, result) {
    if (!err) {
      return command.resolve(result);
    }
    if (err instanceof Redis.ReplyError) {
      var errv = err.message.split(' ');
      if (errv[0] === 'MOVED' || errv[0] === 'ASK') {
        var hostPort = errv[2].split(':');
        var node = _this.createNode(hostPort[1], hostPort[0]);
        if (errv[0] === 'MOVED') {
          _this.slots[errv[1]] = node;
          tryConnection();
          if (++_this.fails > _this.options.refreshAfterFails) {
            _this.fails = 0;
            _this.initializeSlotsCache();
          }
        } else {
          tryConnection(false, node);
        }
      } else {
        command.reject(err);
      }
    } else {
      tryConnection(true);
    }
  });

  tryConnection();

  function tryConnection (random, asking) {
    var redis;
    if (random) {
      redis = _this.nodes[_.sample(Object.keys(_this.nodes))];
    } else if (asking) {
      redis = asking;
      redis.asking();
    } else {
      redis = _this.slots[clusterCommand.slot];
    }
    if (redis) {
      redis.sendCommand(clusterCommand);
      // not connected
    } else if (_this.options.enableOfflineQueue) {
      _this.offlineQueue.push(command);
    } else {
      command.reject(new Error('Cluster isn\'t connected and enableOfflineQueue options is false'));
    }
  }
};

RedisCluster.prototype.getInfoFromNode = function (redis, callback) {
  var _this = this;
  redis.cluster('slots', utils.timeout(function (err, result) {
    if (err) {
      redis.disconnect();
      return callback(err);
    }
    var oldNodes = _this.nodes;
    for (var i = 0; i < result.length; ++i) {
      var item = result[i];
      var host = item[2][0];
      var port = item[2][1];
      var node = _this.createNode(port, host);
      delete oldNodes[host + ':' + port];
      for (var slot = item[0]; slot <= item[1]; ++ slot) {
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
