'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var _ = require('lodash');
var Redis = require('../redis');

function ConnectionPool(redisOptions) {
  EventEmitter.call(this);
  this.redisOptions = redisOptions;

  // this.masters + this.slaves = this.nodes
  this.nodes = {};
  this.masters = {};
  this.slaves = {};

  this.specifiedOptions = {};
}

util.inherits(ConnectionPool, EventEmitter);

/**
 * Find or create a connection to the node
 *
 * @param {Object} node - the node to connect to
 * @param {boolean} [readOnly=false] - whether the node is a slave
 * @return {Redis}
 * @public
 */
ConnectionPool.prototype.findOrCreate = function (node, readOnly) {
  node.port = node.port || 6379;
  node.host = node.host || '127.0.0.1';
  node.key = node.key || node.host + ':' + node.port;
  readOnly = Boolean(readOnly);

  if (this.specifiedOptions[node.key]) {
    _.assign(node, this.specifiedOptions[node.key]);
  } else {
    this.specifiedOptions[node.key] = node;
  }

  if (this.nodes[node.key] && this.nodes[node.key].options.readOnly !== readOnly) {
    this.remove(node.key);
  }

  if (!this.nodes[node.key]) {
    var redis = this.nodes[node.key] = new Redis(_.defaults({
      retryStrategy: null,
      enableOfflineQueue: true,
      readOnly: readOnly
    }, node, this.redisOptions, { lazyConnect: true }));
    this[readOnly ? 'slaves' : 'masters'][node.key] = redis;

    var _this = this;
    redis.once('end', function () {
      _this.remove(node.key);
      _this.emit('-node', redis);
      if (!Object.keys(_this.nodes).length) {
        _this.emit('drain');
      }
    });

    this.emit('+node', redis);
  }

  return this.nodes[node.key];
};

/**
 * Remove a node from the pool
 *
 * @param {string} key
 * @private
 */
ConnectionPool.prototype.remove = function (key) {
  if (this.nodes[key]) {
    this.nodes[key].disconnect();
    delete this.nodes[key];
    delete this.masters[key];
    delete this.slaves[key];
  }
};

/**
 * Reset the pool with a set of nodes.
 * The old node will be removed.
 *
 * @param {Object[]} nodes
 * @public
 */
ConnectionPool.prototype.reset = function (nodes) {
  var newNodes = {};
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    node.key = node.host + ':' + node.port;
    newNodes[node.key] = node;
  }
  var _this = this;
  Object.keys(this.nodes).forEach(function (key) {
    if (!newNodes[key]) {
      _this.remove(key);
    }
  });
  Object.keys(newNodes).forEach(function (key) {
    _this.findOrCreate(newNodes[key], newNodes[key].readOnly);
  });
};

module.exports = ConnectionPool;
