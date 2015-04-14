var Redis = require('./redis');
var utils = require('./utils');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var debug = require('debug')('ioredis:cluster');
var _ = require('lodash');

function RedisCluster (startupNodes) {
  EventEmitter.call(this);

  this.startupNodes = startupNodes;
  this.refreshTableASAP = false;

  this.initializeSlotsCache();
}

util.inherits(RedisCluster, EventEmitter);

RedisCluster.prototype.initializeSlotsCache = function () {
  var _this = this;
  tryNode(0);
  function tryNode(index) {
    if (index === _this.startupNodes.length) {
      _this.silentEmit('error', new Error('None of startup nodes is available'));
      index = 0;
    }
    debug('try to connect to the node %d', index);
    getInfoFromNode(_this.startupNodes[index], function (err, result) {
      if (err) {
        return tryNode(index + 1);
      }
      _this.slots = result.slots;
      _this.nodes = result.nodes;
      _this.populateStartupNodes();
      _this.refreshTableASAP = false;
    });
  }
};

RedisCluster.prototype.populateStartupNodes = function () {
  var i;
  for (i = 0; i < this.startupNodes.length; ++i) {
    var node = this.startupNodes[i];
    if (!node.name) {
      node.name = node.host + ':' + node.port;
    }
  }
  for (i = 0; i < this.nodes.length; ++i) {
    this.startupNodes.push(this.nodes[i]);
  }
  this.startupNodes = _.uniq(this.startupNodes, function (node) {
    return node.name;
  });
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

function getInfoFromNode (node, callback) {
  var redis = new Redis(node);
  redis.cluster('slots', utils.timeout(function (err, result) {
    if (err) {
      redis.disconnect();
      return callback(err);
    }
    var info = { nodes: [], slots: {} };
    for (var i = 0; i < result.length; ++i) {
      var item = result[i];
      for (var slot = item[0]; slot <= item[1]; ++ slot) {
        var host = item[2][0];
        var port = item[2][1];
        var node = {
          host: host,
          port: port,
          name: host + ':' + port
        };
        info.nodes.push(node);
        info.slots[slot] = node;
      }
    }
    callback(null, info);
  }, 1000));
}

module.exports = RedisCluster;
