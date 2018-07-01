'use strict';

var util = require('util');
var utils = require('../utils');
var EventEmitter = require('events').EventEmitter;
var _ = require('../utils/lodash');
var Redis = require('../redis');
var debug = require('../utils/debug')('ioredis:cluster:connectionPool');

function ConnectionPool(redisOptions) {
  EventEmitter.call(this);
  this.redisOptions = redisOptions;

  // master + slave = all
  this.nodes = {
    all: {},
    master: {},
    slave: {}
  };

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
  setKey(node);
  readOnly = Boolean(readOnly);

  if (this.specifiedOptions[node.key]) {
    Object.assign(node, this.specifiedOptions[node.key]);
  } else {
    this.specifiedOptions[node.key] = node;
  }

  var redis;
  if (this.nodes.all[node.key]) {
    redis = this.nodes.all[node.key];
    if (redis.options.readOnly !== readOnly) {
      redis.options.readOnly = readOnly;
      debug('Change role of %s to %s', node.key, readOnly ? 'slave' : 'master');
      redis[readOnly ? 'readonly' : 'readwrite']().catch(_.noop);
      if (readOnly) {
        delete this.nodes.master[node.key];
        this.nodes.slave[node.key] = redis;
      } else {
        delete this.nodes.slave[node.key];
        this.nodes.master[node.key] = redis;
      }
    }
  } else {
    debug('Connecting to %s as %s', node.key, readOnly ? 'slave' : 'master');
    redis = new Redis(_.defaults({
      // Never try to reconnect when a node is lose,
      // instead, waiting for a `MOVED` error and
      // fetch the slots again.
      retryStrategy: null,
      // Offline queue should be enabled so that
      // we don't need to wait for the `ready` event
      // before sending commands to the node.
      enableOfflineQueue: true,
      readOnly: readOnly
    }, node, this.redisOptions, { lazyConnect: true }));
    this.nodes.all[node.key] = redis;
    this.nodes[readOnly ? 'slave' : 'master'][node.key] = redis;

    var _this = this;
    redis.once('end', function () {
      delete _this.nodes.all[node.key];
      delete _this.nodes.master[node.key];
      delete _this.nodes.slave[node.key];
      _this.emit('-node', redis);
      if (!Object.keys(_this.nodes.all).length) {
        _this.emit('drain');
      }
    });

    this.emit('+node', redis);

    redis.on('error', function (error) {
      _this.emit('nodeError', error);
    });
  }

  return redis;
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
  nodes.forEach(function (node) {
    var options = {};
    if (typeof node === 'object') {
      _.defaults(options, node);
    } else if (typeof node === 'string') {
      _.defaults(options, utils.parseURL(node));
    } else if (typeof node === 'number') {
      options.port = node;
    } else {
      throw new Error('Invalid argument ' + node);
    }
    if (typeof options.port === 'string') {
      options.port = parseInt(options.port, 10);
    }
    delete options.db;

    setKey(options);
    newNodes[options.key] = options;
  }, this);

  var _this = this;
  Object.keys(this.nodes.all).forEach(function (key) {
    if (!newNodes[key]) {
      debug('Disconnect %s because the node does not hold any slot', key);
      _this.nodes.all[key].disconnect();
    }
  });
  Object.keys(newNodes).forEach(function (key) {
    var node = newNodes[key];
    _this.findOrCreate(node, node.readOnly);
  });
};

/**
 * Set key property
 *
 * @private
 */
function setKey(node) {
  node = node || {};
  node.port = node.port || 6379;
  node.host = node.host || '127.0.0.1';
  node.key = node.key || node.host + ':' + node.port;
  return node;
}

module.exports = ConnectionPool;
