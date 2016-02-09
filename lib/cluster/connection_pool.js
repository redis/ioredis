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

  var redis;
  if (this.nodes[node.key]) {
    redis = this.nodes[node.key];
    if (redis.options.readOnly !== readOnly) {
      redis.options.readOnly = readOnly;
      redis[readOnly ? 'readonly' : 'readwrite']().catch(function () {});
      if (readOnly) {
        delete this.masters[node.key];
        this.slaves[node.key] = redis;
      } else {
        delete this.slaves[node.key];
        this.masters[node.key] = redis;
      }
    }
  } else {
    redis = new Redis(_.defaults({
      retryStrategy: null,
      readOnly: readOnly
    }, node, this.redisOptions, { lazyConnect: true }));
    this.nodes[node.key] = redis;
    this[readOnly ? 'slaves' : 'masters'][node.key] = redis;

    var _this = this;
    redis.once('end', function () {
      delete _this.nodes[node.key];
      delete _this.masters[node.key];
      delete _this.slaves[node.key];
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
      _this.nodes[key].disconnect();
    }
  });
  Object.keys(newNodes).forEach(function (key) {
    _this.findOrCreate(newNodes[key], newNodes[key].readOnly);
  });
};

module.exports = ConnectionPool;
