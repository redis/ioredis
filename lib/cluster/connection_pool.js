'use strict';

var util = require('util');
var utils = require('../utils');
var EventEmitter = require('events').EventEmitter;
var _ = require('lodash');
var Redis = require('../redis');

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
    _.assign(node, this.specifiedOptions[node.key]);
  } else {
    this.specifiedOptions[node.key] = node;
  }

  var redis;
  if (this.nodes.all[node.key]) {
    redis = this.nodes.all[node.key];
    if (redis.options.readOnly !== readOnly) {
      redis.options.readOnly = readOnly;
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
    redis = new Redis(_.defaults({
      retryStrategy: null,
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
      _this.nodes.all[key].disconnect();
    }
  });
  Object.keys(newNodes).forEach(function (key) {
    _this.findOrCreate(newNodes[key], newNodes[key].readOnly);
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
