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
  if (!Array.isArray(this.sentinels)) {
    this.sentinels = this.options.sentinels;
  }

  var _this = this;
  var lastError;
  connectToNext();

  function connectToNext() {
    _this.currentPoint += 1;
    if (_this.currentPoint === _this.sentinels.length) {
      _this.currentPoint = -1;

      var retryDelay;
      if (typeof _this.options.sentinelRetryStrategy === 'function') {
        retryDelay = _this.options.sentinelRetryStrategy(++_this.retryAttempts);
      }
      if (typeof retryDelay !== 'number') {
        debug('All sentinels are unreachable and retry is disabled, emitting error...');
        var error = 'All sentinels are unreachable.';
        if (lastError) {
          error += ' Last error: ' + lastError.message;
        }
        return callback(new Error(error));
      }
      debug('All sentinels are unreachable. Retrying from scratch after %d', retryDelay);
      setTimeout(connectToNext, retryDelay);
      return;
    }

    var endpoint = _this.sentinels[_this.currentPoint];
    _this.resolve(endpoint, function (err, resolved) {
      if (!_this.connecting) {
        callback(new Error(utils.CONNECTION_CLOSED_ERROR_MSG));
        return;
      }
      if (resolved) {
        _this.stream = net.createConnection(resolved);
        callback(null, _this.stream);
      } else if (err) {
        debug('failed to connect to sentinel %s:%s because %s', endpoint.host, endpoint.port, err);
        lastError = err;
        connectToNext();
      } else {
        debug('connected to sentinel %s:%s successfully, but got a invalid reply: %s',
          endpoint.host, endpoint.port, resolved);
        connectToNext();
      }
    });
  }
};

SentinelConnector.prototype.updateSentinels = function (client, callback) {
  var _this = this;
  client.sentinel('sentinels', this.options.name, function (err, result) {
    if (err) {
      client.disconnect();
      return callback(err);
    }
    if (Array.isArray(result)) {
      for (var i = 0; i < result.length; ++i) {
        var sentinel = utils.packObject(result[i]);
        var flags = sentinel.flags ? sentinel.flags.split(',') : [];
        if (flags.indexOf('disconnected') === -1 && sentinel.ip && sentinel.port) {
          var endpoint = { host: sentinel.ip, port: parseInt(sentinel.port) };
          var isDuplicate = _this.sentinels.some(function (o) {
            return o.host === endpoint.host && o.port === endpoint.port;
          });
          if (!isDuplicate) {
            debug('adding sentinel %s:%s', endpoint.host, endpoint.port);
            _this.sentinels.push(endpoint);
          }
        }
      }
      debug('sentinels', _this.sentinels);
    }
    callback(null);
  });
};

SentinelConnector.prototype.resolveMaster = function (client, callback) {
  var _this = this;
  client.sentinel('get-master-addr-by-name', this.options.name, function (err, result) {
    if (err) {
      client.disconnect();
      return callback(err);
    }
    _this.updateSentinels(client, function (err) {
      client.disconnect();
      if (err) {
        return callback(err);
      }
      callback(null, Array.isArray(result) ? { host: result[0], port: result[1] } : null);
    });
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
        if (slave.flags && !slave.flags.match(/(disconnected|s_down|o_down)/)) {
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
    connectTimeout: this.options.connectTimeout,
    dropBufferSupport: true
  });

  // ignore the errors since resolve* methods will handle them
  client.on('error', noop);

  if (this.options.role === 'slave') {
    this.resolveSlave(client, callback);
  } else {
    this.resolveMaster(client, callback);
  }
};

function noop() {}

module.exports = SentinelConnector;
