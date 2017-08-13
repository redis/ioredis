'use strict';

var _ = require('../utils/lodash');
var net = require('net');
var tls = require('tls');
var utils = require('../utils');

function Connector(options) {
  this.options = options;
}

Connector.prototype.check = function () {
  return true;
};

Connector.prototype.disconnect = function () {
  this.connecting = false;
  if (this.stream) {
    this.stream.end();
  }
};

Connector.prototype.connect = function (callback) {
  this.connecting = true;
  var connectionOptions;
  if (this.options.path) {
    connectionOptions = _.pick(this.options, ['path']);
  } else {
    connectionOptions = _.pick(this.options, ['port', 'host', 'family']);
  }
  if (this.options.tls) {
    _.assign(connectionOptions, this.options.tls);
  }

  var _this = this;
  process.nextTick(function () {
    if (!_this.connecting) {
      callback(new Error(utils.CONNECTION_CLOSED_ERROR_MSG));
      return;
    }
    var stream;

    try {
      if (_this.options.tls) {
        stream = tls.connect(connectionOptions);
      } else {
        stream = net.createConnection(connectionOptions);
      }
    } catch (err) {
      callback(err);
      return;
    }

    _this.stream = stream;
    callback(null, stream);
  });
};

module.exports = Connector;
