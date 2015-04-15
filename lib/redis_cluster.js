var Redis = require('./redis');
var utils = require('./utils');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('ioredis:cluster');
var _ = require('lodash');
var ClusterCommand = require('./cluster_command');
var Commander = require('./commander');

function RedisCluster (startupNodes) {
  EventEmitter.call(this);
  Commander.call(this);

  this.nodes = {};
  this.slots = [];
  this.startupNodes = startupNodes.map(function (options) {
    return this.createNode(options.port, options.host);
  }, this);
  this.refreshTableASAP = true;
  this.connections = {};

  this.initializeSlotsCache();
}

util.inherits(RedisCluster, EventEmitter);
_.extend(RedisCluster.prototype, Commander.prototype);

RedisCluster.prototype.createNode = function (port, host) {
  var key = host + ':' + port;
  if (!this.nodes[key]) {
    this.nodes[key] = new Redis({ port: port, host: host, lazyConnect: true });
  }
  return this.nodes[key];
};

RedisCluster.prototype.initializeSlotsCache = function (callback) {
  var _this = this;

  tryNode(0);

  function tryNode(index) {
    if (index === _this.startupNodes.length) {
      _this.silentEmit('error', new Error('None of startup nodes is available'));
      index = 0;
    }
    debug('try to connect to the node %d', index);
    _this.getInfoFromNode(_this.startupNodes[index], function (err) {
      if (err) {
        return tryNode(index + 1);
      }
      _this.refreshTableASAP = false;
      if (typeof callback === 'function') {
        callback();
      }
    });
  }
};

/**
 * Emit only when there's at least one listener.
 *
 * @param {string} eventName - Event to emit
 * @param {...*} arguments - Arguments
 * @return {boolean} Returns true if event had listeners, false otherwise.
 * @protected
 */
RedisCluster.prototype.silentEmit = function (eventName) {
  if (this.listeners(eventName).length > 0) {
    return this.emit.apply(this, arguments);
  }
  return false;
};

RedisCluster.prototype.sendCommand = function (command) {
  var _this = this;
  if (this.refreshTableASAP) {
    var args = arguments;
    this.initializeSlotsCache(function () {
      _this.sendCommand.apply(_this, args);
    });
    return;
  }
  var clusterCommand = new ClusterCommand(command, function (err, result) {
    console.log(arguments);
    if (!err) {
      return command.resolve(result);
    }
    var errv = err.message.split(' ');
    if (errv[0] === 'MOVED') {
      var node = errv[2].split(':');
      _this.slots[errv[1]] = _this.createNode(node[1], node[0]);

      // Serve replied with MOVED. It's better for us to
      // ask for CLUSTER NODES the next time.
      // _this.refreshTableASAP = true;
      tryConnection();
    } else if (errv[0] === 'ASK') {
    } else {
      tryConnection(true);
    }
  });

  tryConnection();

  function tryConnection (random) {
    console.log('try');
    var redis;
    if (random) {
      redis = _this.nodes[_.sample(Object.keys(_this.nodes))];
    } else {
      redis = _this.slots[clusterCommand.slot];
    }
    console.log(redis.options.port);
    redis.sendCommand(clusterCommand);
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
