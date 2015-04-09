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
  this.role = role;
  this.name = name;
}

util.inherits(Sentinel, EventEmitter);

Sentinel.prototype.connect = function () {
  var item = this.endpoints.shift();
  this.endpoints.push(item);

  debug('connecting to sentinel %s:%s', item.host, item.port);

  if (this.sentinel) {
    this.sentinel.disconnect();
  }
  this.sentinel = new Redis(_.extend({
    retryStrategy: function () {},
    enableReadyCheck: false
  }, item));

  var _this = this;
  resolveClient(this, function (err, result) {
    if (result) {
      debug('get %s from sentinels %s:%s', _this.role, result.host, result.port);
      var connection = net.createConnection(result);
      _this.emit('connect', connection);
    } else {
      if (err) {
        debug('get %s failed with error %s, try next sentinel...', _this.role, err.message);
      } else {
        debug('get %s failed, try next sentinel...', _this.role);
      }
      _this.connect();
    }
  });
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
          if (slave.flags.indexOf('disconnected') === -1) {
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
