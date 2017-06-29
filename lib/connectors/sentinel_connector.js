'use strict';

var _ = require('../utils/lodash');
var util = require('util');
var net = require('net');
var utils = require('../utils');
var Connector = require('./connector');
var debug = require('debug')('ioredis:SentinelConnector');
var Redis;

function SentinelConnector(options) {
  Connector.call(this, options);
  if (this.options.sentinels.length === 0) {
    throw new Error('Requires at least one sentinel to connect to.');
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

SentinelConnector.prototype.connect = function (callback, eventEmitter) {
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

      var retryDelay = typeof _this.options.sentinelRetryStrategy === 'function'
        ? _this.options.sentinelRetryStrategy(++_this.retryAttempts)
        : null;

      var errorMsg = typeof retryDelay !== 'number'
        ? 'All sentinels are unreachable and retry is disabled.'
        : 'All sentinels are unreachable. Retrying from scratch after ' + retryDelay + 'ms';

      if (lastError) {
        errorMsg += ' Last error: ' + lastError.message;
      }

      debug(errorMsg);

      var error = new Error(errorMsg);
      if (typeof retryDelay === 'number') {
        setTimeout(connectToNext, retryDelay);
        eventEmitter('error', error);
      } else {
        callback(error);
      }
      return;
    }

    var endpoint = _this.sentinels[_this.currentPoint];
    _this.resolve(endpoint, function (err, resolved) {
      if (!_this.connecting) {
        callback(new Error(utils.CONNECTION_CLOSED_ERROR_MSG));
        return;
      }
      if (resolved) {
        debug('resolved: %s:%s', resolved.host, resolved.port);
        _this.stream = net.createConnection(resolved);
        callback(null, _this.stream);
      } else {
        var endpointAddress = endpoint.host + ':' + endpoint.port;
        var errorMsg = err
          ? 'failed to connect to sentinel ' + endpointAddress + ' because ' + err.message
          : 'connected to sentinel ' + endpointAddress + ' successfully, but got an invalid reply: ' + resolved;

        debug(errorMsg);

        eventEmitter('sentinelError', new Error(errorMsg));

        if (err) {
          lastError = err;
        }
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
          var endpoint = { host: sentinel.ip, port: parseInt(sentinel.port, 10) };
          var isDuplicate = _this.sentinels.some(_.bind(isSentinelEql, null, endpoint));
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
  var _this = this;
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
      // allow the options to prefer particular slave(s)
      if (_this.options.preferredSlaves) {
        var preferredSlaves = _this.options.preferredSlaves;
        switch (typeof preferredSlaves) {
        case 'function':
          // use function from options to filter preferred slave
          selectedSlave = _this.options.preferredSlaves(availableSlaves);
          break;
        case 'object':
          if (!Array.isArray(preferredSlaves)) {
            preferredSlaves = [preferredSlaves];
          } else {
            // sort by priority
            preferredSlaves.sort(function (a, b) {
              // default the priority to 1
              if (!a.prio) {
                a.prio = 1;
              }
              if (!b.prio) {
                b.prio = 1;
              }

              // lowest priority first
              if (a.prio < b.prio) {
                return -1;
              }
              if (a.prio > b.prio) {
                return 1;
              }
              return 0;
            });
          }
          // loop over preferred slaves and return the first match
          for (var p = 0; p < preferredSlaves.length; p++) {
            for (var a = 0; a < availableSlaves.length; a++) {
              if (availableSlaves[a].ip === preferredSlaves[p].ip) {
                if (availableSlaves[a].port === preferredSlaves[p].port) {
                  selectedSlave = availableSlaves[a];
                  break;
                }
              }
            }
            if (selectedSlave) {
              break;
            }
          }
          // if none of the preferred slaves are available, a random available slave is returned
          break;
        }
      }
      if (!selectedSlave) {
        // get a random available slave
        selectedSlave = _.sample(availableSlaves);
      }
    }
    callback(null, selectedSlave ? { host: selectedSlave.ip, port: selectedSlave.port } : null);
  });
};

SentinelConnector.prototype.resolve = function (endpoint, callback) {
  if (typeof Redis === 'undefined') {
    Redis = require('../redis');
  }
  var client = new Redis({
    port: endpoint.port || 26379,
    host: endpoint.host,
    family: endpoint.family || this.options.family,
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

function isSentinelEql(a, b) {
  return ((a.host || '127.0.0.1') === (b.host || '127.0.0.1')) &&
    ((a.port || 26379) === (b.port || 26379));
}

module.exports = SentinelConnector;
