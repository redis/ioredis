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

Sentinel.prototype.connect = function (role) {
  var item = this.endpoints.shift();
  this.endpoints.push(item);

  debug('connecting to sentinel %s:%s', item.host, item.port);

  var sentinel = new Redis(item);

  var _this = this;
  sentinel.on('connect', function () {
    debug('connected to sentinel %s:%s', item.host, item.port);
    if (_this.role === 'slave') {
      sentinel.sentinel('slaves', _this.name, function (err, result) {
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
        if (selectedSlave) {
          var connection = net.createConnection({ host: selectedSlave.ip, port: selectedSlave.port });
          _this.emit('connect', connection);
        } else {
          debug('cannot get slave, try next sentinel...');
          sentinel.disconnect({ reconnect: true });
        }
      });
    } else {
      sentinel.sentinel('get-master-addr-by-name', _this.name, function (err, result) {
        if (Array.isArray(result)) {
          debug('get master from sentinel: %s', result);
          var connection = net.createConnection({ host: result[0], port: result[1] });
          _this.emit('connect', connection);
        } else {
          debug('cannot get master, try next sentinel...');
          sentinel.disconnect({ reconnect: true });
        }
      });
    }
  });
};

module.exports = Sentinel;
