'use strict';

var util = require('util');
var utils = require('./utils');
var EventEmitter = require('events').EventEmitter;
var Redis = require('./redis');
var net = require('net');
var debug = require('debug')('ioredis:sentinel');
var _ = require('lodash');

function Sentinel (endpoints, role, name) {
  EventEmitter.call(this);

  this.endpoints = endpoints;
  this.endpointsIndex = 0;
  this.role = role;
  this.name = name;
  this.connecting = false;
}

util.inherits(Sentinel, EventEmitter);

Sentinel.prototype.connect = function () {
  this.connecting = true;

  var _this = this;

  if (this.endpointsIndex === this.endpoints.length) {
    this.emit('error', new Error('All sentinels are unreachable'));
    if (this.endpoints.length > 0) {
      this.endpointsIndex = 0;
      setImmediate(function () {
        if (_this.connecting) {
          _this.connect();
        }
      });
    }
    return;
  }

  var item = this.endpoints[this.endpointsIndex];
  this.endpointsIndex += 1;

  debug('connecting to sentinel %s:%s', item.host, item.port);

  if (this.sentinel) {
    this.sentinel.disconnect();
  }
  this.sentinel = new Redis(_.extend({
    retryStrategy: function () {},
    enableReadyCheck: false
  }, item));

  resolveClient(this, utils.timeout(function (err, result) {
    if (result) {
      debug('get %s from sentinels %s:%s', _this.role || 'master', result.host, result.port);
      _this.emit('connect', net.createConnection(result));
    } else {
      if (err) {
        debug('get %s failed with error "%s"', _this.role, err.message);
      } else {
        debug('get %s failed', _this.role);
      }
      if (_this.connecting) {
        debug('try next sentinel...');
        _this.connect();
      } else {
        _this.sentinel.disconnect();
        _this.sentinel = null;
      }
    }
  }, 1000));
};

Sentinel.prototype.disconnect = function (options) {
  this.connecting = false;
  this.sentinel.disconnect(options);
};

function resolveClient(self, callback) {
  debug('connected to sentinel');

  if (self.role === 'slave') {
    self.sentinel.sentinel('slaves', self.name, function (err, result) {
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
  } else {
    self.sentinel.sentinel('get-master-addr-by-name', self.name, function (err, result) {
      if (err) {
        return callback(err);
      }
      callback(null, Array.isArray(result) ? { host: result[0], port: result[1] } : null);
    });
  }
}

module.exports = Sentinel;
