'use strict';

var _ = require('lodash');
var util = require('util');
var net = require('net');
var utils = require('../utils');
var Connector = require('./connector');
var debug = require('debug')('ioredis:SentinelConnector');
var Redis;

function SentinelConnector(options) {
  Connector.call(this, options);
  if (this.options.sentinels.length === 0) {
    throw new Error('Requires at least on sentinel to connect to.');
  }
  if (!this.options.name) {
    throw new Error('Requires the name of master.');
  }
}

util.inherits(SentinelConnector, Connector);

SentinelConnector.prototype.check = function (info) {
  if (info.role && this.options.role !== info.role) {
    debug('role invalid, expected %s, but got %s', this.options.role, info.role);
    return false;
  }
  return true;
};

SentinelConnector.prototype.connect = function (callback) {
  this.connecting = true;
  this.retryAttempts = 0;

  if (typeof this.currentPoint !== 'number') {
    this.currentPoint = -1;
  }

  var _this = this;
  connectToNext();

  function connectToNext() {
    _this.currentPoint += 1;
    if (_this.currentPoint === _this.options.sentinels.length) {
      _this.currentPoint = -1;

      var retryDelay;
      if (typeof _this.options.sentinelRetryStrategy === 'function') {
        retryDelay = _this.options.sentinelRetryStrategy(++_this.retryAttempts);
      }
      if (typeof retryDelay !== 'number') {
        debug('All sentinels are unreachable and retry is disabled, emitting error...');
        return callback(new Error('All sentinels are unreachable.'));
      }
      debug('All sentinels are unreachable. Retrying from scratch after %d', retryDelay);
      setTimeout(connectToNext, retryDelay);
      return;
    }

    var endpoint = _this.options.sentinels[_this.currentPoint];
    _this.resolve(endpoint, function (err, resolved) {
      if (!_this.connecting) {
        callback(new Error('Connection is closed.'));
        return;
      }
      if (resolved) {
        _this.stream = net.createConnection(resolved);
        callback(null, _this.stream);
      } else if (err) {
        debug('failed to connect to sentinel %s:%s because %s', endpoint.host, endpoint.port, err);
        connectToNext();
      } else {
        debug('connected to sentinel %s:%s successfully, but got a invalid reply: %s', endpoint.host, endpoint.port, resolved);
        connectToNext();
      }
    });
  }
};

SentinelConnector.prototype.resolveMaster = function (client, callback) {
  client.sentinel('get-master-addr-by-name', this.options.name, function (err, result) {
    client.disconnect();
    if (err) {
      return callback(err);
    }
    callback(null, Array.isArray(result) ? { host: result[0], port: result[1] } : null);
  });
};

SentinelConnector.prototype.resolveSlave = function (client, callback) {
  client.sentinel('slaves', this.options.name, function (err, result) {
    client.disconnect();
    if (err) {
      return callback(err);
    }
    var selectedSlave;
    if (Array.isArray(result)) {
      var availableSlaves = [];
      for (var i = 0; i < result.length; ++i) {
        var slave = utils.packObject(result[i]);
        if (slave.flags && slave.flags.indexOf('disconnected') === -1) {
          availableSlaves.push(slave);
        }
      }
      selectedSlave = _.sample(availableSlaves);
    }
    callback(null, selectedSlave ? { host: selectedSlave.ip, port: selectedSlave.port } : null);
  });
};

SentinelConnector.prototype.resolve = function (endpoint, callback) {
  if (typeof Redis === 'undefined') {
    Redis = require('../redis');
  }
  var client = new Redis({
    port: endpoint.port,
    host: endpoint.host,
    retryStrategy: null,
    enableReadyCheck: false,
    connectTimeout: 2000
  });

  if (this.options.role === 'slave') {
    this.resolveSlave(client, callback);
  } else {
    this.resolveMaster(client, callback);
  }
};

module.exports = SentinelConnector;
