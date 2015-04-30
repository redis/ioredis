'use strict';

var _ = require('lodash');
var net = require('net');

function Connector(options) {
  this.options = options;
}

Connector.prototype.check = function () {
  return true;
};

Connector.prototype.disconnect = function () {
  if (this.stream) {
    this.stream.end();
  }
};

Connector.prototype.connect = function (callback) {
  var connectionOptions;
  if (this.options.path) {
    connectionOptions = _.pick(this.options, ['path']);
  } else {
    connectionOptions = _.pick(this.options, ['port', 'host', 'family']);
  }

  var stream = this.stream = net.createConnection(connectionOptions);
  process.nextTick(function () {
    callback(null, stream);
  });
};

module.exports = Connector;
